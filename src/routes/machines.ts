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
 * POST /api/machines/:id/start - Proxy to gateway
 */
machines.post("/:id/start", async (c) => {
  try {
    const machineId = c.req.param("id");
    const body = await c.req.json();

    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const url = `${eventGatewayBase}/api/machines/${machineId}/start`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gateway API ${response.status}: ${errorText}`);
    }

    const json = await response.json();
    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error proxying machine start:", error);
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
 * POST /api/machines/:id/stop - Proxy to gateway
 */
machines.post("/:id/stop", async (c) => {
  try {
    const machineId = c.req.param("id");

    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const url = `${eventGatewayBase}/api/machines/${machineId}/stop`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gateway API ${response.status}: ${errorText}`);
    }

    const json = await response.json();
    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error proxying machine stop:", error);
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

/**
 * GET /api/machines/:id/event - Proxy to gateway
 */
machines.get("/:id/event", async (c) => {
  try {
    const machineId = c.req.param("id");

    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const url = `${eventGatewayBase}/api/machines/${machineId}/event`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gateway API ${response.status}: ${errorText}`);
    }

    const json = await response.json();
    return c.json(json, response.status);
  } catch (error: any) {
    console.error("❌ Error proxying machine event:", error);
    return c.json(
      {
        success: false,
        error: "Failed to get machine event",
        message: error.message,
      },
      500
    );
  }
});

export default machines;
