import { Hono } from "hono";
import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

const events = new Hono();

/**
 * GET /api/events/:type/:id - Proxy to gateway for event detail
 */
events.get("/:type/:id", async (c) => {
  try {
    const eventType = c.req.param("type");
    const eventId = c.req.param("id");

    // Map event type to gateway endpoint
    const validTypes = ["drop-off", "employee-quota", "maintenance", "error-payment"];
    if (!validTypes.includes(eventType)) {
      return c.json(
        {
          success: false,
          error: "Invalid event type",
          message: `Event type must be one of: ${validTypes.join(", ")}`,
        },
        400
      );
    }

    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const url = `${eventGatewayBase}/api/events/${eventType}/${eventId}`;

    const response = await fetchWithTimeout(url, 15000, {
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
    console.error("❌ Error proxying event detail:", error);
    return c.json(
      {
        success: false,
        error: "Failed to get event detail",
        message: error.message,
      },
      500
    );
  }
});

/**
 * POST /api/events/:type - Proxy to gateway for event creation
 */
events.post("/:type", async (c) => {
  try {
    const eventType = c.req.param("type");
    const body = await c.req.json();

    // Map event type to gateway endpoint
    const validTypes = ["drop-off", "employee-quota", "maintenance", "error-payment"];
    if (!validTypes.includes(eventType)) {
      return c.json(
        {
          success: false,
          error: "Invalid event type",
          message: `Event type must be one of: ${validTypes.join(", ")}`,
        },
        400
      );
    }

    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const url = `${eventGatewayBase}/api/events/${eventType}`;

    const response = await fetchWithTimeout(url, 15000, {
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
    return c.json(json, response.status);
  } catch (error: any) {
    console.error("❌ Error proxying event creation:", error);
    return c.json(
      {
        success: false,
        error: "Failed to create event",
        message: error.message,
      },
      500
    );
  }
});

export default events;

