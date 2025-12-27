import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

// Hardcoded event gateway URL - mudah diganti
const EVENT_GATEWAY_BASE_URL = config.eventGateway?.base || "http://localhost:54990";

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

  const url = `${EVENT_GATEWAY_BASE_URL}${endpoint}`;

  try {
    console.log(`📝 Creating ${type} event:`, data);

    const response = await fetchWithTimeout(
      url,
      10000, // 10 second timeout
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(data),
      }
    );

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
        message: errorJson.message || errorJson.error || "Failed to create event",
      };
    }

    const result = await response.json();

    console.log(`✅ ${type} event created successfully:`, result);

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

