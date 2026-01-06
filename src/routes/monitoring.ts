import { Hono } from "hono";
import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

const monitoring = new Hono();

/**
 * GET /api/monitoring/status - Proxy to gateway for status monitoring
 */
monitoring.get("/status", async (c) => {
  try {
    const limit = c.req.query("limit") || "50";
    const days = c.req.query("days") || "7";
    const machineId = c.req.query("machine_id");

    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    
    // Build query string
    const queryParams = new URLSearchParams({
      limit,
      days,
    });
    if (machineId) {
      queryParams.append("machine_id", machineId);
    }

    const url = `${eventGatewayBase}/api/monitoring/status?${queryParams.toString()}`;

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
    console.error("❌ Error proxying monitoring status:", error);
    return c.json(
      {
        success: false,
        error: "Failed to get monitoring status",
        message: error.message || "Unknown error",
      },
      500
    );
  }
});

export default monitoring;

