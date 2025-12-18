import { config } from "../config.js";
import { getAllMachineIds, MACHINE_CONFIG } from "../constants.js";
import { fetchWithTimeout, createUpstreamHeaders } from "../utils/fetch.js";
import { leaderboardCache } from "../utils/cache.js";
import type { LeaderboardResponse } from "../types.js";

/**
 * Build URL untuk leaderboard berdasarkan machine ID
 */
function buildLeaderboardUrl(
  machineId: string,
  params: {
    filterBy?: string;
    bulan?: string;
    tanggalAwal?: string;
    tanggalAkhir?: string;
  }
): string {
  const {
    filterBy = "bulan",
    bulan = "2025-10",
    tanggalAwal,
    tanggalAkhir,
  } = params;

  const base = config.upstream.base;
  let url = `${base}/list_transaksi_snap_konsumen?sort_by=transaksi&order_by=DESC&limit=1000&offset=0&idmesin=${machineId}`;

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
 * Generate frequency leaderboard
 */
export async function generateFrequencyLeaderboard(params: {
  filterBy?: string;
  bulan?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
}): Promise<LeaderboardResponse> {
  console.log("📊 Generating frequency leaderboard...");

  const machineIds = getAllMachineIds();
  const controllersMap = MACHINE_CONFIG.machineLabels;

  const leaderboard: Array<{
    machineId: string;
    machineLabel: string;
    frequency: number;
    totalRevenue: number;
    lastTransaction: string | null;
  }> = [];

  for (const machineId of machineIds) {
    try {
      const url = buildLeaderboardUrl(machineId, params);
      const headers = createUpstreamHeaders(
        config.upstream.bearer,
        "leaderboard/1.0"
      );
      const res = await fetchWithTimeout(url, 10000, { headers });

      if (!res.ok) continue;

      const json = await res.json();
      const transactions = json.data || [];
      const frequency = transactions.length;

      if (frequency > 0) {
        leaderboard.push({
          machineId,
          machineLabel: controllersMap[machineId] || machineId,
          frequency,
          totalRevenue: transactions.reduce(
            (sum: number, t: any) => sum + (t.total_harga || 0),
            0
          ),
          lastTransaction: transactions[0]?.waktu_diterima_raw || null,
        });
      }
    } catch (error) {
      console.error(`Error fetching data for machine ${machineId}:`, error);
      continue;
    }
  }

  // Sort by frequency (descending)
  leaderboard.sort((a, b) => b.frequency - a.frequency);

  console.log(
    `✅ Frequency leaderboard generated: ${leaderboard.length} machines`
  );

  const responseData: LeaderboardResponse = {
    success: true,
    data: leaderboard.map((item, index) => ({
      rank: index + 1,
      machineId: item.machineId,
      machineLabel: item.machineLabel,
      frequency: item.frequency,
      totalRevenue: item.totalRevenue,
      lastTransaction: item.lastTransaction,
    })),
    total_machines: leaderboard.length,
    period: { filterBy: params.filterBy || "bulan", ...params },
  };

  // Update cache
  leaderboardCache.frequency.set(responseData);
  return responseData;
}

/**
 * Generate revenue leaderboard
 */
export async function generateRevenueLeaderboard(params: {
  filterBy?: string;
  bulan?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
}): Promise<LeaderboardResponse> {
  console.log("💰 Generating revenue leaderboard...");

  const machineIds = getAllMachineIds();
  const controllersMap = MACHINE_CONFIG.machineLabels;

  const leaderboard: Array<{
    machineId: string;
    machineLabel: string;
    frequency: number;
    totalRevenue: number;
    lastTransaction: string | null;
  }> = [];

  for (const machineId of machineIds) {
    try {
      const url = buildLeaderboardUrl(machineId, params);
      const headers = createUpstreamHeaders(
        config.upstream.bearer,
        "leaderboard/1.0"
      );
      const res = await fetchWithTimeout(url, 10000, { headers });

      if (!res.ok) continue;

      const json = await res.json();
      const transactions = json.data || [];
      const totalRevenue = transactions.reduce(
        (sum: number, t: any) => sum + (t.total_harga || 0),
        0
      );

      if (totalRevenue > 0) {
        leaderboard.push({
          machineId,
          machineLabel: controllersMap[machineId] || machineId,
          frequency: transactions.length,
          totalRevenue,
          lastTransaction: transactions[0]?.waktu_diterima_raw || null,
        });
      }
    } catch (error) {
      console.error(`Error fetching data for machine ${machineId}:`, error);
      continue;
    }
  }

  // Sort by total revenue (descending)
  leaderboard.sort((a, b) => b.totalRevenue - a.totalRevenue);

  console.log(
    `✅ Revenue leaderboard generated: ${leaderboard.length} machines`
  );

  const responseData: LeaderboardResponse = {
    success: true,
    data: leaderboard.map((item, index) => ({
      rank: index + 1,
      machineId: item.machineId,
      machineLabel: item.machineLabel,
      frequency: item.frequency,
      totalRevenue: item.totalRevenue,
      lastTransaction: item.lastTransaction,
    })),
    total_machines: leaderboard.length,
    total_revenue: leaderboard.reduce(
      (sum, item) => sum + item.totalRevenue,
      0
    ),
    period: { filterBy: params.filterBy || "bulan", ...params },
  };

  // Update cache
  leaderboardCache.revenue.set(responseData);
  return responseData;
}
