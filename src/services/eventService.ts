import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

// Event gateway configuration from config
const EVENT_GATEWAY_BASE_URL =
  config.eventGateway?.base || "http://localhost:54990";
const EVENT_GATEWAY_ENABLED = config.eventGateway?.enabled !== false;
const EVENT_GATEWAY_TIMEOUT = config.eventGateway?.timeout || 15000;

// Log event gateway configuration on module load
console.log("🔧 Event Gateway Configuration:", {
  base: EVENT_GATEWAY_BASE_URL,
  enabled: EVENT_GATEWAY_ENABLED,
  timeout: EVENT_GATEWAY_TIMEOUT,
});

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Event data types based on API documentation
 */
export type DropOffEventData = {
  machine_id: string;
  customer_name: string;
  customer_phone?: string;
  duration_minutes: number;
  occurred_at?: string;
};

export type ErrorPaymentEventData = {
  machine_id: string;
  description: string;
  duration_minutes: number;
  occurred_at?: string;
};

export type EmployeeQuotaEventData = {
  machine_id: string;
  employee_name: string;
  duration_minutes: number;
  occurred_at?: string;
};

export type MaintenanceEventData = {
  machine_id: string;
  mtype: "cuci_kosong" | "tube_clean" | "other";
  duration_minutes: number;
  note?: string;
  occurred_at?: string;
};

export type EventData =
  | { type: "drop-off"; data: DropOffEventData }
  | { type: "error-payment"; data: ErrorPaymentEventData }
  | { type: "employee-quota"; data: EmployeeQuotaEventData }
  | { type: "maintenance"; data: MaintenanceEventData };

/**
 * Create event via event gateway API with retry mechanism
 * Returns success status and response data
 */
export async function createEvent(eventData: EventData): Promise<{
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}> {
  // Check if event gateway is disabled
  if (!EVENT_GATEWAY_ENABLED) {
    console.log(
      `⚠️ Event gateway is disabled, skipping ${eventData.type} event`
    );
    return {
      success: false,
      error: "Event gateway disabled",
      message: "Event gateway is disabled via configuration",
    };
  }

  const { type, data } = eventData;

  // Build endpoint URL based on event type
  let endpoint = "";
  switch (type) {
    case "drop-off":
      endpoint = "/api/events/drop-off";
      break;
    case "error-payment":
      endpoint = "/api/events/error-payment";
      break;
    case "employee-quota":
      endpoint = "/api/events/employee-quota";
      break;
    case "maintenance":
      endpoint = "/api/events/maintenance";
      break;
    default:
      return {
        success: false,
        error: "Unknown event type",
        message: `Event type '${type}' is not supported`,
      };
  }

  const url = `${EVENT_GATEWAY_BASE_URL}${endpoint}`;
  const maxRetries = 3;
  const baseTimeout = EVENT_GATEWAY_TIMEOUT;

  // Log URL being used (without sensitive data)
  console.log(`📝 Creating ${type} event to: ${url}`);
  console.log(`📝 Event data:`, {
    ...data,
    // Don't log full data if it's too large
  });

  // Retry logic with exponential backoff
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Increase timeout slightly for retries
      const timeout = baseTimeout + (attempt - 1) * 5000;

      const response = await fetchWithTimeout(url, timeout, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "laundry-monitor/1.0",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorJson;
        try {
          errorJson = JSON.parse(errorText);
        } catch {
          errorJson = { message: errorText };
        }

        // Don't retry on 4xx errors (client errors)
        if (response.status >= 400 && response.status < 500) {
          console.error(
            `❌ Failed to create ${type} event (client error, no retry):`,
            response.status,
            errorJson
          );

          return {
            success: false,
            error: `HTTP ${response.status}`,
            message:
              errorJson.message || errorJson.error || "Failed to create event",
          };
        }

        // Retry on 5xx errors
        throw new Error(
          `HTTP ${response.status}: ${errorJson.message || errorText}`
        );
      }

      const result = await response.json();

      console.log(
        `✅ ${type} event created successfully (attempt ${attempt}):`,
        {
          id: result.data?.id,
          message: result.message,
        }
      );

      return {
        success: true,
        message: result.message || "Event created successfully",
        data: result.data,
      };
    } catch (error: any) {
      lastError = error;

      // Check error type
      const isNetworkError =
        error.code === "UND_ERR_SOCKET" ||
        error.message?.includes("fetch failed") ||
        error.message?.includes("ECONNREFUSED") ||
        error.message?.includes("ETIMEDOUT") ||
        error.message?.includes("ENOTFOUND");

      const isTimeoutError =
        error.name === "AbortError" || error.message?.includes("timeout");

      console.error(
        `❌ Error creating ${type} event (attempt ${attempt}/${maxRetries}):`,
        {
          error: error.message,
          code: error.code,
          isNetworkError,
          isTimeoutError,
          url,
        }
      );

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  // All retries failed
  const errorMessage =
    lastError?.code === "UND_ERR_SOCKET"
      ? "Event gateway connection closed unexpectedly. Check if event gateway is accessible and running."
      : lastError?.message || "Unknown error";

  console.error(
    `❌ Failed to create ${type} event after ${maxRetries} attempts:`,
    {
      error: errorMessage,
      url,
      eventGatewayBase: EVENT_GATEWAY_BASE_URL,
    }
  );

  return {
    success: false,
    error: lastError?.code || "NETWORK_ERROR",
    message: `Failed to create event after ${maxRetries} attempts: ${errorMessage}`,
  };
}
