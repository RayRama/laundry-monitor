import { config } from "../config.js";
import { getMachineLabel } from "../constants.js";
import { fetchWithTimeout } from "../utils/fetch.js";

/**
 * Fetch events leaderboard from event gateway
 */
async function fetchEventsLeaderboard(params: {
  filter?: string;
  startDate?: string;
  endDate?: string;
}): Promise<any> {
  const { filter, startDate, endDate } = params;

  const eventGatewayBase =
    config.eventGateway?.base ||
    "http://localhost:54990" ||
    "http://localhost:3999";

  const urlParams = new URLSearchParams();

  if (filter) {
    urlParams.append("filter", filter);
  }
  if (startDate) {
    urlParams.append("start_date", startDate);
  }
  if (endDate) {
    urlParams.append("end_date", endDate);
  }

  const url = `${eventGatewayBase}/api/analytics/leaderboard?${urlParams}`;
  console.log(`📊 Fetching events leaderboard from: ${url}`);

  try {
    const response = await fetchWithTimeout(url, 15000, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Event Gateway API ${response.status}`);
    }

    const json = await response.json();
    console.log(
      `✅ Events leaderboard fetched: ${
        json.data?.leaderboard?.length || 0
      } machines`
    );

    return json;
  } catch (error: any) {
    console.error("❌ Error fetching events leaderboard:", error);
    throw error;
  }
}

/**
 * Generate events leaderboard with merged data
 * Now uses gateway which already includes transactions merge
 */
export async function generateEventsLeaderboard(params: {
  filter?: string;
  startDate?: string;
  endDate?: string;
}): Promise<{
  success: boolean;
  data: {
    filter: string;
    start_date: string;
    end_date: string;
    leaderboard: Array<{
      machine_id: string;
      machine_label: string;
      transaksi: number;
      drop_off: number;
      error_payment: number;
      cuci_kosong: number;
      employee_quota: number;
      tube_clean: number;
      total: number;
    }>;
  };
  message?: string;
}> {
  console.log("📊 Generating events leaderboard via gateway...");

  const { filter = "today", startDate, endDate } = params;

  try {
    // Fetch from analytics leaderboard route (already includes transactions merge)
    const eventsData = await fetchEventsLeaderboard({ filter, startDate, endDate });

    if (!eventsData.success || !eventsData.data?.leaderboard) {
      throw new Error("Invalid events data from event gateway");
    }

    const eventsLeaderboard = eventsData.data.leaderboard;
    const responseData = eventsData.data;

    // Map machine_id to machine_label and ensure transaksi field exists
    const mergedLeaderboard = eventsLeaderboard.map((item: any) => {
      const machineId = item.machine_id;
      const machineLabel = getMachineLabel(machineId);

      return {
        machine_id: machineId,
        machine_label: machineLabel,
        transaksi: item.transaksi || 0, // Already merged by gateway
        drop_off: item.drop_off || 0,
        error_payment: item.error_payment || 0,
        cuci_kosong: item.cuci_kosong || 0,
        employee_quota: item.employee_quota || 0,
        tube_clean: item.tube_clean || 0,
        total: item.total || 0, // Already includes transactions
      };
    });

    // Sort by total (descending) - gateway should already sort, but ensure it
    mergedLeaderboard.sort((a, b) => b.total - a.total);

    console.log(
      `✅ Events leaderboard generated: ${mergedLeaderboard.length} machines`
    );

    return {
      success: true,
      data: {
        filter: responseData.filter || filter,
        start_date: responseData.start_date || "",
        end_date: responseData.end_date || "",
        leaderboard: mergedLeaderboard,
      },
      message: "Events leaderboard retrieved successfully",
    };
  } catch (error: any) {
    console.error("❌ Error generating events leaderboard:", error);
    throw error;
  }
}
