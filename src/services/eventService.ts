import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

// Use relative URL to proxy through frontend API
// Frontend API will proxy to gateway
// In browser context, we can't use config, so we'll use relative URL
const getEventBaseUrl = () => {
  // If running in Node.js (server-side), use config
  if (typeof process !== "undefined" && process.env) {
    return config.eventGateway?.base || "http://localhost:54990";
  }
  // If running in browser, use relative URL (will be proxied by frontend API)
  return "";
};

/**
 * Event data types based on API documentation
 */
export type DropOffEventData = {
  machine_id: string;
  customer_name: string;
  customer_phone?: string;
  duration_minutes: number;
  employee_id?: number;
  other_employee_name?: string;
  occurred_at?: string;
};

export type ErrorPaymentEventData = {
  machine_id: string;
  description: string;
  duration_minutes: number;
  employee_id?: number;
  other_employee_name?: string;
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
  employee_id?: number;
  other_employee_name?: string;
  occurred_at?: string;
};

export type EventData =
  | { type: "drop-off"; data: DropOffEventData }
  | { type: "error-payment"; data: ErrorPaymentEventData }
  | { type: "employee-quota"; data: EmployeeQuotaEventData }
  | { type: "maintenance"; data: MaintenanceEventData };

/**
 * Create event via event gateway API
 * Returns success status and response data
 */
export async function createEvent(eventData: EventData): Promise<{
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}> {
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

  const baseUrl = getEventBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  console.log(`[EventService] Creating ${type} event:`, {
    url,
    endpoint,
    baseUrl,
    data: { ...data, machine_id: data.machine_id },
  });

  try {
    const response = await fetchWithTimeout(url, 15000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
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

      console.error(
        `❌ Failed to create ${type} event:`,
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

    const result = await response.json();
    console.log(`✅ ${type} event created successfully`, result);

    return {
      success: true,
      message: result.message || "Event created successfully",
      data: result.data,
    };
  } catch (error: any) {
    console.error(`❌ Error creating ${type} event:`, error);
    return {
      success: false,
      error: error.message || "Unknown error",
      message: `Failed to create event: ${error.message}`,
    };
  }
}
