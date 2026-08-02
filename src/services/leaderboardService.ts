import { config } from "../config.js";
import { MACHINE_CONFIG } from "../constants.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { leaderboardCache } from "../utils/cache.js";
import type { LeaderboardResponse } from "../types.js";

type CombinedLeaderboardResponse = {
  frequency: LeaderboardResponse;
  revenue: LeaderboardResponse;
};

function mapMachineLabels(response: any): LeaderboardResponse {
  const controllersMap = MACHINE_CONFIG.machineLabels;
  const mappedData = (response.data || []).map((item: any) => ({
    ...item,
    machineLabel:
      (controllersMap[
        item.machineId as keyof typeof controllersMap
      ] as string) || item.machineId,
  }));
  return {
    ...response,
    success: true,
    data: mappedData,
    total_machines: response.total_machines || mappedData.length,
  };
}

/** Preferred page-load path: one gateway request and one aggregate query. */
export async function generateCombinedLeaderboard(params: {
  filterBy?: string;
  bulan?: string;
  tahun?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
  authorization?: string;
  cookie?: string;
}): Promise<CombinedLeaderboardResponse> {
  const eventGatewayBase = config.eventGateway?.base || "http://localhost:54990";
  const urlParams = new URLSearchParams();
  if (params.filterBy) urlParams.append("filter_by", params.filterBy);
  if (params.bulan) urlParams.append("bulan", params.bulan);
  if (params.tahun) urlParams.append("tahun", params.tahun);
  if (params.tanggalAwal) urlParams.append("tanggal_awal", params.tanggalAwal);
  if (params.tanggalAkhir) urlParams.append("tanggal_akhir", params.tanggalAkhir);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (params.authorization) headers.Authorization = params.authorization;
  if (params.cookie) headers.Cookie = params.cookie;
  const response = await fetchWithTimeout(
    `${eventGatewayBase}/api/leaderboard/combined?${urlParams}`,
    30000,
    { headers }
  );
  if (!response.ok) throw new Error(`Gateway API ${response.status}`);
  const json = await response.json();
  if (!json.success || !json.data?.frequency || !json.data?.revenue) {
    throw new Error("Invalid combined leaderboard response");
  }

  const result = {
    frequency: mapMachineLabels(json.data.frequency),
    revenue: mapMachineLabels(json.data.revenue),
  };
  const cacheKey = JSON.stringify({
    filterBy: params.filterBy,
    bulan: params.bulan,
    tahun: params.tahun,
    tanggalAwal: params.tanggalAwal,
    tanggalAkhir: params.tanggalAkhir,
  });
  leaderboardCache.frequency.set(result.frequency, cacheKey);
  leaderboardCache.revenue.set(result.revenue, cacheKey);
  return result;
}

/**
 * Generate frequency leaderboard - now calls gateway instead of SmartLink directly
 */
export async function generateFrequencyLeaderboard(params: {
  filterBy?: string;
  bulan?: string;
  tahun?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
  authorization?: string;
  cookie?: string;
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
  if (params.tahun) {
    urlParams.append("tahun", params.tahun);
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
    const upstreamHeaders: Record<string, string> = {
      Accept: "application/json",
    };
    if (params.authorization) upstreamHeaders.Authorization = params.authorization;
    if (params.cookie) upstreamHeaders.Cookie = params.cookie;
    const response = await fetchWithTimeout(url, 30000, {
      method: "GET",
      headers: upstreamHeaders,
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
    const cacheKey = JSON.stringify({
      filterBy: params.filterBy,
      bulan: params.bulan,
      tahun: params.tahun,
      tanggalAwal: params.tanggalAwal,
      tanggalAkhir: params.tanggalAkhir,
    });
    leaderboardCache.frequency.set(responseData, cacheKey);
    return responseData;
  } catch (error: any) {
    console.error("❌ Error fetching frequency leaderboard from gateway:", error);
    
    // Try to return cached data if available (fallback)
    const cacheKey = JSON.stringify({
      filterBy: params.filterBy,
      bulan: params.bulan,
      tahun: params.tahun,
      tanggalAwal: params.tanggalAwal,
      tanggalAkhir: params.tanggalAkhir,
    });
    const cached = leaderboardCache.frequency.get(cacheKey);
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
  tahun?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
  authorization?: string;
  cookie?: string;
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
  if (params.tahun) {
    urlParams.append("tahun", params.tahun);
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
    const upstreamHeaders: Record<string, string> = {
      Accept: "application/json",
    };
    if (params.authorization) upstreamHeaders.Authorization = params.authorization;
    if (params.cookie) upstreamHeaders.Cookie = params.cookie;
    const response = await fetchWithTimeout(url, 30000, {
      method: "GET",
      headers: upstreamHeaders,
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
    const cacheKey = JSON.stringify({
      filterBy: params.filterBy,
      bulan: params.bulan,
      tahun: params.tahun,
      tanggalAwal: params.tanggalAwal,
      tanggalAkhir: params.tanggalAkhir,
    });
    leaderboardCache.revenue.set(responseData, cacheKey);
    return responseData;
  } catch (error: any) {
    console.error("❌ Error fetching revenue leaderboard from gateway:", error);
    
    // Try to return cached data if available (fallback)
    const cacheKey = JSON.stringify({
      filterBy: params.filterBy,
      bulan: params.bulan,
      tahun: params.tahun,
      tanggalAwal: params.tanggalAwal,
      tanggalAkhir: params.tanggalAkhir,
    });
    const cached = leaderboardCache.revenue.get(cacheKey);
    if (cached) {
      console.log("📦 Returning cached revenue leaderboard data due to error");
      return cached;
    }
    
    throw error;
  }
}
