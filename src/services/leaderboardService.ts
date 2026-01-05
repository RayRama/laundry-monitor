import { config } from "../config.js";
import { MACHINE_CONFIG } from "../constants.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { leaderboardCache } from "../utils/cache.js";
import type { LeaderboardResponse } from "../types.js";

/**
 * Generate frequency leaderboard - now calls gateway instead of SmartLink directly
 */
export async function generateFrequencyLeaderboard(params: {
  filterBy?: string;
  bulan?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
}): Promise<LeaderboardResponse> {
  console.log("📊 Generating frequency leaderboard via gateway...");

  const eventGatewayBase = config.eventGateway?.base || "http://localhost:54990";
  const urlParams = new URLSearchParams();

  if (params.filterBy) {
    urlParams.append("filter_by", params.filterBy);
  }
  if (params.bulan) {
    urlParams.append("bulan", params.bulan);
  }
  if (params.tanggalAwal) {
    urlParams.append("tanggal_awal", params.tanggalAwal);
  }
  if (params.tanggalAkhir) {
    urlParams.append("tanggal_akhir", params.tanggalAkhir);
  }

  const url = `${eventGatewayBase}/api/leaderboard/frequency?${urlParams}`;
  console.log(`📊 Fetching frequency leaderboard from: ${url}`);

  try {
    const response = await fetchWithTimeout(url, 30000, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Gateway API ${response.status}`);
    }

    const json = await response.json();
    
    if (!json.success || !json.data) {
      throw new Error("Invalid response from gateway");
    }

    // Map machine_id to machine_label using MACHINE_CONFIG
    const controllersMap = MACHINE_CONFIG.machineLabels;
    const mappedData = json.data.data.map((item: any) => ({
      ...item,
      machineLabel:
        (controllersMap[
          item.machineId as keyof typeof controllersMap
        ] as string) || item.machineId,
    }));

    const responseData: LeaderboardResponse = {
      success: true,
      data: mappedData,
      total_machines: json.data.total_machines || mappedData.length,
      period: json.data.period || { filterBy: params.filterBy || "bulan", ...params },
    };

    // Update cache
    leaderboardCache.frequency.set(responseData);
    return responseData;
  } catch (error: any) {
    console.error("❌ Error fetching frequency leaderboard from gateway:", error);
    
    // Try to return cached data if available (fallback)
    const cached = leaderboardCache.frequency.get();
    if (cached) {
      console.log("📦 Returning cached frequency leaderboard data due to error");
      return cached;
    }
    
    throw error;
  }
}

/**
 * Generate revenue leaderboard - now calls gateway instead of SmartLink directly
 */
export async function generateRevenueLeaderboard(params: {
  filterBy?: string;
  bulan?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
}): Promise<LeaderboardResponse> {
  console.log("💰 Generating revenue leaderboard via gateway...");

  const eventGatewayBase = config.eventGateway?.base || "http://localhost:54990";
  const urlParams = new URLSearchParams();

  if (params.filterBy) {
    urlParams.append("filter_by", params.filterBy);
  }
  if (params.bulan) {
    urlParams.append("bulan", params.bulan);
  }
  if (params.tanggalAwal) {
    urlParams.append("tanggal_awal", params.tanggalAwal);
  }
  if (params.tanggalAkhir) {
    urlParams.append("tanggal_akhir", params.tanggalAkhir);
  }

  const url = `${eventGatewayBase}/api/leaderboard/revenue?${urlParams}`;
  console.log(`💰 Fetching revenue leaderboard from: ${url}`);

  try {
    const response = await fetchWithTimeout(url, 30000, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Gateway API ${response.status}`);
    }

    const json = await response.json();
    
    if (!json.success || !json.data) {
      throw new Error("Invalid response from gateway");
    }

    // Map machine_id to machine_label using MACHINE_CONFIG
    const controllersMap = MACHINE_CONFIG.machineLabels;
    const mappedData = json.data.data.map((item: any) => ({
      ...item,
      machineLabel:
        (controllersMap[
          item.machineId as keyof typeof controllersMap
        ] as string) || item.machineId,
    }));

    const responseData: LeaderboardResponse = {
      success: true,
      data: mappedData,
      total_machines: json.data.total_machines || mappedData.length,
      total_revenue: json.data.total_revenue,
      period: json.data.period || { filterBy: params.filterBy || "bulan", ...params },
    };

    // Update cache
    leaderboardCache.revenue.set(responseData);
    return responseData;
  } catch (error: any) {
    console.error("❌ Error fetching revenue leaderboard from gateway:", error);
    
    // Try to return cached data if available (fallback)
    const cached = leaderboardCache.revenue.get();
    if (cached) {
      console.log("📦 Returning cached revenue leaderboard data due to error");
      return cached;
    }
    
    throw error;
  }
}
