import { Hono } from "hono";
import { machineCache } from "../utils/cache.js";
import { calculateMachineETag } from "../utils/etag.js";
import {
  isDataStale,
  refreshMachines,
  getMachineLabel,
} from "../services/machineService.js";
import { createEvent, type EventData } from "../services/eventService.js";
import { config } from "../config.js";
import { MACHINE_CONFIG } from "../constants.js";

const machines = new Hono();

/**
 * GET /api/machines - Get all machines
 */
machines.get("/", async (c) => {
  // Check if data is stale and trigger refresh if needed
  const stale = isDataStale();
  console.log(
    `Data stale check: ${stale}, snapshot exists: ${!!machineCache.get()}, meta: ${JSON.stringify(
      machineCache.get()?.meta
    )}`
  );

  if (stale) {
    console.log("Data is stale, triggering refresh...");
    try {
      await refreshMachines();
      console.log("Refresh completed successfully");
    } catch (error) {
      console.error("Failed to refresh data:", error);
    }
  }

  const currentSnapshot = machineCache.get() || {
    machines: [],
    summary: { dryer: {}, washer: {} },
    meta: {
      ts: new Date().toISOString(),
      stale: true,
      version: "v1",
      timezone: "Asia/Jakarta",
      utc_offset: "+07:00",
    },
  };

  // Calculate ETag from stable view
  const currentETag = calculateMachineETag(currentSnapshot.machines);

  // Check If-None-Match header
  const ifNoneMatch = c.req.header("If-None-Match");

  if (ifNoneMatch === currentETag) {
    // Data hasn't changed, return 304 with headers
    const stale = isDataStale();
    const lastSuccess = machineCache.getLastSuccessTime()
      ? new Date(machineCache.getLastSuccessTime()!).toISOString()
      : null;

    c.header("ETag", currentETag);
    c.header("X-Data-Stale", stale.toString());
    c.header("X-Last-Success", lastSuccess || "");

    return new Response(null, { status: 304 });
  }

  // Data has changed or no If-None-Match, return 200 with full data
  const lastSuccess = machineCache.getLastSuccessTime()
    ? new Date(machineCache.getLastSuccessTime()!).toISOString()
    : null;

  c.header("ETag", currentETag);
  c.header("X-Data-Stale", stale.toString());
  c.header("X-Last-Success", lastSuccess || "");

  // Add screen size info to response
  const response = {
    ...currentSnapshot,
    meta: {
      ...currentSnapshot.meta,
      screen_info: {
        breakpoints: {
          mobile: 767,
          tablet: 1023,
          desktop: 1919,
          tv: 1920,
        },
      },
    },
  };

  return c.json(response);
});

/**
 * POST /api/machines/:id/start - Start a machine
 */
machines.post("/:id/start", async (c) => {
  try {
    const machineId = c.req.param("id");
    const body = await c.req.json();
    const { duration, program = "normal", event } = body;

    if (!duration || duration < 1 || duration > 180) {
      return c.json(
        {
          success: false,
          error: "Invalid duration",
          message: "Duration must be between 1-180 minutes",
        },
        400
      );
    }

    console.log(
      `Starting machine ${machineId} for ${duration} minutes with program ${program}`
    );

    const bearer = config.upstream.bearer;

    if (!bearer) {
      return c.json(
        {
          success: false,
          error: "Configuration error",
          message: "Upstream bearer token not configured",
        },
        500
      );
    }

    // Construct the correct URL for turning on machine
    const turnOnUrl = `https://owner-api.smartlink.id/masterData/snap_mesin/turn_on_mesin_timer?idsnap_mesin=${machineId}`;

    console.log(`Making request to: ${turnOnUrl}`);

    // Create form data
    const formData = new FormData();
    formData.append("menit", duration.toString());

    // Make API call to actual machine controller
    const response = await fetch(turnOnUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Origin: "https://dashboard-vue.smartlink.id",
        Referer: "https://dashboard-vue.smartlink.id",
      },
      body: formData,
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error: ${response.status} - ${errorText}`);
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log("API Response:", result);

    const machineLabel = getMachineLabel(machineId);

    // Record event if provided (non-blocking)
    let eventResult = null;
    if (event && typeof event === "object" && event.type && event.data) {
      try {
        // Event gateway requires hardware ID (machineId), not label
        // Frontend already sends machine_id as hardware ID in collectEventData
        // Ensure we use hardware ID, not label
        const eventData: EventData = {
          type: event.type,
          data: {
            ...event.data,
            // Use hardware ID (machineId) for event gateway
            // event.data.machine_id from frontend is already hardware ID
            machine_id: machineId, // Always use hardware ID for event gateway
          },
        };

        console.log(
          `📝 Recording event: ${event.type} for machine ${machineLabel} (hardware ID: ${machineId})`
        );
        eventResult = await createEvent(eventData);

        if (!eventResult.success) {
          console.error(
            `⚠️ Failed to record event (non-blocking):`,
            eventResult.message || eventResult.error
          );
        }
      } catch (error: any) {
        console.error("⚠️ Error recording event (non-blocking):", error);
        eventResult = {
          success: false,
          error: error.message || "Unknown error",
        };
      }
    }

    return c.json({
      success: true,
      message: `Mesin ${machineLabel} berhasil dinyalakan untuk ${duration} menit`,
      data: {
        machineId,
        machineLabel,
        duration,
        program,
        startedAt: new Date().toISOString(),
        apiResponse: result,
        eventRecorded: eventResult?.success || false,
        eventError:
          eventResult?.success === false ? eventResult.message : undefined,
      },
    });
  } catch (error: any) {
    console.error("Error starting machine:", error);
    return c.json(
      {
        success: false,
        error: "Failed to start machine",
        message: error.message,
      },
      500
    );
  }
});

/**
 * POST /api/machines/:id/stop - Stop a machine
 */
machines.post("/:id/stop", async (c) => {
  try {
    const machineId = c.req.param("id");

    console.log(`Stopping machine ${machineId}`);

    const bearer = config.upstream.bearer;

    if (!bearer) {
      return c.json(
        {
          success: false,
          error: "Configuration error",
          message: "Upstream bearer token not configured",
        },
        500
      );
    }

    // Construct the correct URL for turning off machine
    const turnOffUrl = `https://owner-api.smartlink.id/masterData/snap_mesin/turn_off_mesin?idsnap_mesin=${machineId}`;

    console.log(`Making request to: ${turnOffUrl}`);

    // Make API call to actual machine controller
    const response = await fetch(turnOffUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Origin: "https://dashboard-vue.smartlink.id",
        Referer: "https://dashboard-vue.smartlink.id",
      },
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error: ${response.status} - ${errorText}`);
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log("API Response:", result);

    const machineLabel = getMachineLabel(machineId);

    return c.json({
      success: true,
      message: `Mesin ${machineLabel} berhasil dimatikan`,
      data: {
        machineId,
        machineLabel,
        stoppedAt: new Date().toISOString(),
        apiResponse: result,
      },
    });
  } catch (error: any) {
    console.error("Error stopping machine:", error);
    return c.json(
      {
        success: false,
        error: "Failed to stop machine",
        message: error.message,
      },
      500
    );
  }
});

export default machines;
