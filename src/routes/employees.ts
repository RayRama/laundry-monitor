import { Hono } from "hono";
import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

const employees = new Hono();

// Event gateway configuration from config
const EVENT_GATEWAY_BASE_URL =
  config.eventGateway?.base || "http://localhost:3999";

/**
 * GET /api/employees - Get employees list (proxy to event gateway)
 */
employees.get("/", async (c) => {
  try {
    // Get query parameters
    const outletId = c.req.query("outlet_id");
    const isActive = c.req.query("is_active");
    const limit = c.req.query("limit") || "100";
    const offset = c.req.query("offset") || "0";

    // Build query string
    const params = new URLSearchParams();
    if (outletId) params.append("outlet_id", outletId);
    if (isActive) params.append("is_active", isActive);
    params.append("limit", limit);
    params.append("offset", offset);

    const url = `${EVENT_GATEWAY_BASE_URL}/api/employees?${params.toString()}`;

    // Forward request to event gateway
    const response = await fetchWithTimeout(url, 10000, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorJson;
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        errorJson = { message: errorText };
      }

      console.error(
        `❌ Failed to fetch employees:`,
        response.status,
        errorJson
      );

      return c.json(
        {
          success: false,
          error: `HTTP ${response.status}`,
          message: errorJson.message || errorJson.error || "Failed to fetch employees",
        },
        response.status
      );
    }

    const result = await response.json();
    return c.json(result);
  } catch (error: any) {
    console.error(`❌ Error fetching employees:`, error);
    return c.json(
      {
        success: false,
        error: error.message || "Unknown error",
        message: `Failed to fetch employees: ${error.message}`,
      },
      500
    );
  }
});

export default employees;

