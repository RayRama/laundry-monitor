import { config } from "../config.js";
import { getMachineLabel, MACHINE_CONFIG } from "../constants.js";
import { fetchWithTimeout, createUpstreamHeaders } from "../utils/fetch.js";
import { fetchTransactionSummary } from "./transactionService.js";

/**
 * Convert analytics filter to transactions filter format
 */
function convertFilterToTransactionsFormat(
  filter?: string,
  startDate?: string,
  endDate?: string
): {
  filterBy: string;
  bulan?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
} {
  // If custom with dates, use periode
  if (filter === "custom" && startDate && endDate) {
    return {
      filterBy: "periode",
      tanggalAwal: startDate,
      tanggalAkhir: endDate,
    };
  }

  // For other filters, we'll need to calculate date ranges
  // But for now, let's use periode with calculated dates
  const now = new Date();
  let tanggalAwal: string;
  let tanggalAkhir: string;

  if (filter === "today") {
    tanggalAwal = now.toISOString().split("T")[0];
    tanggalAkhir = now.toISOString().split("T")[0];
  } else if (filter === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    tanggalAwal = yesterday.toISOString().split("T")[0];
    tanggalAkhir = yesterday.toISOString().split("T")[0];
  } else if (filter === "this_week") {
    // Get Monday of current week
    const monday = new Date(now);
    const day = monday.getDay();
    const diff = monday.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    monday.setDate(diff);
    tanggalAwal = monday.toISOString().split("T")[0];
    tanggalAkhir = now.toISOString().split("T")[0];
  } else if (filter === "last_7_days") {
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // Include today
    tanggalAwal = sevenDaysAgo.toISOString().split("T")[0];
    tanggalAkhir = now.toISOString().split("T")[0];
  } else if (filter === "this_month") {
    tanggalAwal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-01`;
    tanggalAkhir = now.toISOString().split("T")[0];
  } else if (filter === "this_year") {
    tanggalAwal = `${now.getFullYear()}-01-01`;
    tanggalAkhir = now.toISOString().split("T")[0];
  } else {
    // Default to today
    tanggalAwal = now.toISOString().split("T")[0];
    tanggalAkhir = now.toISOString().split("T")[0];
  }

  return {
    filterBy: "periode",
    tanggalAwal,
    tanggalAkhir,
  };
}

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
 * Build URL untuk fetch transactions per machine (similar to leaderboardService)
 */
function buildTransactionUrlPerMachine(
  machineId: string,
  params: {
    filterBy?: string;
    bulan?: string;
    tanggalAwal?: string;
    tanggalAkhir?: string;
    limit?: string;
  }
): string {
  const {
    filterBy = "periode",
    bulan = "2025-10",
    tanggalAwal,
    tanggalAkhir,
    limit = "1000",
  } = params;

  const base = config.upstream.base;
  let url = `${base}/list_transaksi_snap_konsumen?sort_by=transaksi&order_by=DESC&limit=${limit}&offset=0&idmesin=${machineId}`;

  if (filterBy === "periode" && tanggalAwal && tanggalAkhir) {
    url += `&filter_by=periode&tanggal_awal=${tanggalAwal}&tanggal_akhir=${tanggalAkhir}`;
  } else if (filterBy === "bulan") {
    url += `&filter_by=bulan&bulan=${bulan}`;
  } else {
    url += `&filter_by=tahun&tahun=2025`;
  }

  return url;
}

/**
 * Aggregate transactions by machine ID
 * Since idmesin is not in transaction list response, we fetch per machine in parallel
 */
async function aggregateTransactionsByMachine(params: {
  filter?: string;
  startDate?: string;
  endDate?: string;
}): Promise<Map<string, number>> {
  const transactionsParams = convertFilterToTransactionsFormat(
    params.filter,
    params.startDate,
    params.endDate
  );

  try {
    // Get all machine IDs
    const { getAllMachineIds } = await import("../constants.js");
    const machineIds = getAllMachineIds();

    // Fetch transactions per machine in parallel (since idmesin is only available as filter)
    const fetchMachineTransactions = async (machineId: string) => {
      try {
        // First, fetch summary to get total_nota for this machine
        const summaryParams = {
          filterBy: transactionsParams.filterBy || "periode",
          bulan: transactionsParams.bulan,
          tanggalAwal: transactionsParams.tanggalAwal,
          tanggalAkhir: transactionsParams.tanggalAkhir,
          idmesin: machineId,
          limit: "1", // Just need summary
          offset: "0",
        };

        let totalNota = 0;
        try {
          const summaryData = await fetchTransactionSummary(summaryParams);
          totalNota = summaryData.data?.total_nota || 0;
        } catch (error) {
          console.warn(
            `Failed to fetch summary for machine ${machineId}, using default limit`
          );
        }

        // Use total_nota as limit, with minimum 1000 for safety
        const limit =
          totalNota > 0 ? String(Math.max(totalNota, 1000)) : "10000";

        // Fetch transactions with dynamic limit
        const url = buildTransactionUrlPerMachine(machineId, {
          ...transactionsParams,
          limit,
        });
        const headers = createUpstreamHeaders(
          config.upstream.bearer,
          "leaderboard-events/1.0"
        );
        const res = await fetchWithTimeout(url, 10000, { headers });

        if (!res.ok) return { machineId, count: 0 };

        const json = await res.json();
        const transactions = json.data || [];
        return { machineId, count: transactions.length };
      } catch (error) {
        console.error(
          `Error fetching transactions for machine ${machineId}:`,
          error
        );
        return { machineId, count: 0 };
      }
    };

    // Fetch all machines in parallel
    const results = await Promise.all(machineIds.map(fetchMachineTransactions));

    // Build map from results
    const machineCounts = new Map<string, number>();
    results.forEach(({ machineId, count }) => {
      if (count > 0) {
        // Normalize machine ID for consistency
        const normalizedId = String(machineId).trim().toUpperCase();
        machineCounts.set(normalizedId, count);
      }
    });

    const totalTransactions = results.reduce((sum, r) => sum + r.count, 0);
    console.log(
      `✅ Transactions aggregated: ${machineCounts.size} machines with transactions (total: ${totalTransactions} transactions)`
    );

    return machineCounts;
  } catch (error: any) {
    console.error("❌ Error aggregating transactions:", error);
    // Return empty map on error, don't fail the whole request
    return new Map();
  }
}

/**
 * Generate events leaderboard with merged data
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
  console.log("📊 Generating events leaderboard...");

  const { filter = "today", startDate, endDate } = params;

  try {
    // Fetch events and transactions in parallel
    const [eventsData, transactionCounts] = await Promise.all([
      fetchEventsLeaderboard({ filter, startDate, endDate }),
      aggregateTransactionsByMachine({ filter, startDate, endDate }),
    ]);

    if (!eventsData.success || !eventsData.data?.leaderboard) {
      throw new Error("Invalid events data from event gateway");
    }

    const eventsLeaderboard = eventsData.data.leaderboard;
    const responseData = eventsData.data;

    // Debug: log machine IDs from events
    const eventMachineIds = eventsLeaderboard.map(
      (item: any) => item.machine_id
    );
    console.log(
      "🔍 Machine IDs from events (first 5):",
      eventMachineIds.slice(0, 5)
    );

    // Merge events data with transaction counts
    const mergedLeaderboard = eventsLeaderboard.map((item: any) => {
      const machineId = item.machine_id;
      const machineLabel = getMachineLabel(machineId);

      // Normalize machine ID for lookup (same as in aggregateTransactionsByMachine)
      const normalizedMachineId = String(machineId).trim().toUpperCase();

      // Get transaction count for this machine (try both normalized and original)
      const transaksiCount =
        transactionCounts.get(normalizedMachineId) ||
        transactionCounts.get(machineId) ||
        0;

      return {
        machine_id: machineId,
        machine_label: machineLabel,
        transaksi: transaksiCount,
        drop_off: item.drop_off || 0,
        error_payment: item.error_payment || 0,
        cuci_kosong: item.cuci_kosong || 0,
        employee_quota: item.employee_quota || 0,
        tube_clean: item.tube_clean || 0,
        total: (item.total || 0) + transaksiCount, // Include transactions in total
      };
    });

    // Sort by total (descending)
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
