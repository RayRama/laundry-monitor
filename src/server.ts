import dotenv from "dotenv";

// Load env dari .env.local (jika ada) lalu fallback ke .env
dotenv.config({ path: ".env.local" });
dotenv.config();

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { normalize } from "./normalize.js";
import { MACHINE_CONFIG, getAllMachineIds } from "./constants.js";
import {
  authMiddleware,
  adminMiddleware,
  authenticateUser,
  generateToken,
} from "./auth.js";

const app = new Hono();
app.use(
  "*",
  cors({
    origin: "*",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Cache-Control",
      "Pragma",
      "If-Modified-Since",
      "If-None-Match",
      "ETag",
      "Last-Modified",
    ],
  })
);
const PORT = 3000;

let controllersMap: Record<string, string> | null = null;
let snapshot: any = null;
let lastSuccessTime: number | null = null;

async function loadControllerMap() {
  // Use constants instead of hardcoded values
  controllersMap = MACHINE_CONFIG.machineLabels;
  console.log(
    "✅ Controller map loaded:",
    Object.keys(controllersMap || {}).length,
    "machines"
  );
}

/**
 * Calculate ETag from stable view fields only
 * ETag hanya dihitung dari: id, type, label, slot, status
 * Abaikan field yang sering berubah: tl, dur, updated_at, meta.ts
 */
function calculateETag(machines: any[]): string {
  const stableView = machines.map((machine) => ({
    id: machine.id,
    type: machine.type,
    label: machine.label,
    slot: machine.slot,
    status: machine.status,
  }));

  const stableData = JSON.stringify(stableView);
  return crypto.createHash("md5").update(stableData).digest("hex");
}

/**
 * Check if data is stale based on last success time
 * Stale = true jika sudah lewat 10 menit tanpa sukses refresh
 */
function isDataStale(): boolean {
  // In serverless, use snapshot meta timestamp instead of lastSuccessTime
  if (!snapshot?.meta?.ts) return true;

  // Check if meta already marks as stale
  if (snapshot.meta.stale) return true;

  const lastUpdate = new Date(snapshot.meta.ts).getTime();
  const now = Date.now();
  const twoMinutes = 2 * 60 * 1000; // 2 menit dalam ms (lebih agresif)
  return now - lastUpdate > twoMinutes;
}

async function fetchWithTimeout(
  url: string,
  ms: number,
  init: RequestInit = {}
) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const mergedInit: RequestInit = { ...init, signal: ctrl.signal };
    // Pastikan headers tergabung jika ada
    if (init.headers) {
      mergedInit.headers = init.headers as Record<string, string>;
    }
    return await fetch(url, mergedInit);
  } finally {
    clearTimeout(t);
  }
}

async function refresh() {
  const base = process.env.UPSTREAM_BASE!;
  const outlet = process.env.OUTLET_ID!;
  const url = `${base}/list_snap_mesin?idoutlet=${encodeURIComponent(
    outlet
  )}&offset=0&limit=25`;
  const to = Number(process.env.UPSTREAM_TIMEOUT_MS || 2000);

  try {
    const bearer =
      process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "";
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "machines-local-fixed-slots/1.0",
    };
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;

    const res = await fetchWithTimeout(url, to, { headers });
    if (!res.ok) throw new Error(`upstream ${res.status}`);

    const json = await res.json();
    const rows = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
      ? json
      : [];

    const { list, summary } = normalize(rows, controllersMap);

    // Update last success time on successful refresh
    lastSuccessTime = Date.now();

    snapshot = {
      machines: list,
      summary,
      meta: {
        ts: new Date().toISOString(),
        stale: false,
        version: "v1",
      },
    };
  } catch (e) {
    if (snapshot) {
      snapshot = {
        ...snapshot,
        meta: {
          ...snapshot.meta,
          ts: new Date().toISOString(),
          stale: isDataStale(),
        },
      };
    } else {
      const now = new Date().toISOString();
      const machines: any[] = [];
      snapshot = {
        machines,
        summary: {
          dryer: { total: 0, ready: 0, running: 0, offline: 0 },
          washer: { total: 0, ready: 0, running: 0, offline: 0 },
        },
        meta: { ts: now, stale: true, version: "v1" },
      };
    }
  }
}

app.get("/api/machines", async (c) => {
  // Check if data is stale and trigger refresh if needed
  const stale = isDataStale();
  console.log(
    `Data stale check: ${stale}, snapshot exists: ${!!snapshot}, meta: ${JSON.stringify(
      snapshot?.meta
    )}`
  );

  if (stale) {
    console.log("Data is stale, triggering refresh...");
    try {
      await refresh();
      console.log("Refresh completed successfully");
    } catch (error) {
      console.error("Failed to refresh data:", error);
    }
  }

  const currentSnapshot = snapshot || {
    machines: [],
    summary: { dryer: {}, washer: {} },
    meta: {
      ts: new Date().toISOString(), // UTC+7 (Jakarta)
      stale: true,
      version: "v1",
      timezone: "Asia/Jakarta",
      utc_offset: "+07:00",
    },
  };

  // Calculate ETag from stable view
  const currentETag = calculateETag(currentSnapshot.machines);

  // Check If-None-Match header
  const ifNoneMatch = c.req.header("If-None-Match");

  if (ifNoneMatch === currentETag) {
    // Data hasn't changed, return 304 with headers
    const stale = isDataStale();
    const lastSuccess = lastSuccessTime
      ? new Date(lastSuccessTime).toISOString()
      : null;

    c.header("ETag", currentETag);
    c.header("X-Data-Stale", stale.toString());
    c.header("X-Last-Success", lastSuccess || "");

    return new Response(null, { status: 304 });
  }

  // Data has changed or no If-None-Match, return 200 with full data
  const lastSuccess = lastSuccessTime
    ? new Date(lastSuccessTime).toISOString()
    : null;

  c.header("ETag", currentETag);
  c.header("X-Data-Stale", stale.toString());
  c.header("X-Last-Success", lastSuccess || "");

  // Add screen size info to response
  const response = {
    ...currentSnapshot,
    meta: {
      ...currentSnapshot.meta,
      screen_info: {
        breakpoints: {
          mobile: 767,
          tablet: 1023,
          desktop: 1919,
          tv: 1920,
        },
      },
    },
  };

  return c.json(response);
});

// Start machine endpoint
app.post("/api/machines/:id/start", async (c) => {
  try {
    const machineId = c.req.param("id");
    const body = await c.req.json();
    const { duration, program = "normal" } = body;

    if (!duration || duration < 1 || duration > 180) {
      return c.json(
        {
          success: false,
          error: "Invalid duration",
          message: "Duration must be between 1-180 minutes",
        },
        400
      );
    }

    console.log(
      `Starting machine ${machineId} for ${duration} minutes with program ${program}`
    );

    // Get upstream bearer token
    const bearer =
      process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "";

    if (!bearer) {
      return c.json(
        {
          success: false,
          error: "Configuration error",
          message: "Upstream bearer token not configured",
        },
        500
      );
    }

    // Construct the correct URL for turning on machine
    const turnOnUrl = `https://owner-api.smartlink.id/masterData/snap_mesin/turn_on_mesin_timer?idsnap_mesin=${machineId}`;

    console.log(`Making request to: ${turnOnUrl}`);

    // Create form data
    const formData = new FormData();
    formData.append("menit", duration.toString());

    // Make API call to actual machine controller
    const response = await fetch(turnOnUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Origin: "https://dashboard-vue.smartlink.id",
        Referer: "https://dashboard-vue.smartlink.id",
      },
      body: formData,
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error: ${response.status} - ${errorText}`);
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log("API Response:", result);

    // Get machine label from mapping (same as frontend)
    const MACHINE_ID_MAPPING = {
      D48AFC354603: "D05",
      D48AFC325A64: "D07",
      "2CF4321072A5": "D01",
      "68C63AFC13FA": "D02",
      "483FDA643B85": "D03",
      "48E7296DE4BF": "D04",
      D48AFC35465C: "D06",
      D48AFC31F4C0: "D08",
      D48AFC354357: "D09",
      BCDDC248DF58: "D10",
      C82B961E9BF3: "D11",
      "8CCE4EF44A99": "D12",
      "9C9C1F410120": "W01",
      "98F4ABD8506A": "W02",
      "8CAAB5D53E39": "W03",
      "84F3EB6ED32F": "W04",
      "483FDA69F7C5": "W05",
      "483FDA077794": "W06",
      "807D3A4E5A46": "W07",
      "5CCF3FDBB498": "W08",
      "483FDA6AFDC7": "W10",
      "8CAAB556EF34": "W09",
      "500291EB8F36": "W09_OLD",
      A4CF12F307D1: "W11",
      "68C63AFC1863": "W12",
    };

    const machineLabel = MACHINE_ID_MAPPING[machineId] || machineId;

    return c.json({
      success: true,
      message: `Mesin ${machineLabel} berhasil dinyalakan untuk ${duration} menit`,
      data: {
        machineId,
        machineLabel,
        duration,
        program,
        startedAt: new Date().toISOString(),
        apiResponse: result,
      },
    });
  } catch (error) {
    console.error("Error starting machine:", error);
    return c.json(
      {
        success: false,
        error: "Failed to start machine",
        message: error.message,
      },
      500
    );
  }
});

// Stop machine endpoint
app.post("/api/machines/:id/stop", async (c) => {
  try {
    const machineId = c.req.param("id");

    console.log(`Stopping machine ${machineId}`);

    // Get upstream bearer token
    const bearer =
      process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "";

    if (!bearer) {
      return c.json(
        {
          success: false,
          error: "Configuration error",
          message: "Upstream bearer token not configured",
        },
        500
      );
    }

    // Construct the correct URL for turning off machine
    const turnOffUrl = `https://owner-api.smartlink.id/masterData/snap_mesin/turn_off_mesin?idsnap_mesin=${machineId}`;

    console.log(`Making request to: ${turnOffUrl}`);

    // Make API call to actual machine controller
    const response = await fetch(turnOffUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Origin: "https://dashboard-vue.smartlink.id",
        Referer: "https://dashboard-vue.smartlink.id",
      },
    });

    console.log(`Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error: ${response.status} - ${errorText}`);
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log("API Response:", result);

    // Get machine label from mapping (same as frontend)
    const MACHINE_ID_MAPPING = {
      D48AFC354603: "D05",
      D48AFC325A64: "D07",
      "2CF4321072A5": "D01",
      "68C63AFC13FA": "D02",
      "483FDA643B85": "D03",
      "48E7296DE4BF": "D04",
      D48AFC35465C: "D06",
      D48AFC31F4C0: "D08",
      D48AFC354357: "D09",
      BCDDC248DF58: "D10",
      C82B961E9BF3: "D11",
      "8CCE4EF44A99": "D12",
      "9C9C1F410120": "W01",
      "98F4ABD8506A": "W02",
      "8CAAB5D53E39": "W03",
      "84F3EB6ED32F": "W04",
      "483FDA69F7C5": "W05",
      "483FDA077794": "W06",
      "807D3A4E5A46": "W07",
      "5CCF3FDBB498": "W08",
      "483FDA6AFDC7": "W10",
      "8CAAB556EF34": "W09",
      "500291EB8F36": "W09_OLD",
      A4CF12F307D1: "W11",
      "68C63AFC1863": "W12",
    };

    const machineLabel = MACHINE_ID_MAPPING[machineId] || machineId;

    return c.json({
      success: true,
      message: `Mesin ${machineLabel} berhasil dimatikan`,
      data: {
        machineId,
        machineLabel,
        stoppedAt: new Date().toISOString(),
        apiResponse: result,
      },
    });
  } catch (error) {
    console.error("Error stopping machine:", error);
    return c.json(
      {
        success: false,
        error: "Failed to stop machine",
        message: error.message,
      },
      500
    );
  }
});

app.post("/api/refresh", async (c) => {
  await refresh();
  return c.json({
    ok: true,
    ts: snapshot?.meta?.ts,
    stale: snapshot?.meta?.stale,
  });
});
// Dashboard endpoints
// app.get("/dashboard", async (c) => {
//   try {
//     const html = await fs.readFile("dashboard/index.html", "utf8");
//     return c.html(html);
//   } catch (error) {
//     return c.text("Dashboard not found", 404);
//   }
// });

// Cache untuk dashboard data
let dashboardSummaryCache: any = null;
let dashboardTransactionsCache: any = null;
let lastDashboardSuccessTime: number | null = null;

// Cache untuk leaderboard data
let frequencyLeaderboardCache: any = null;
let revenueLeaderboardCache: any = null;
let lastLeaderboardSuccessTime: number | null = null;

/**
 * Calculate ETag for dashboard data
 */
function calculateDashboardETag(data: any): string {
  const stableData = JSON.stringify(data);
  return crypto.createHash("md5").update(stableData).digest("hex");
}

/**
 * Calculate ETag for leaderboard data
 */
function calculateLeaderboardETag(data: any): string {
  const stableData = JSON.stringify(data);
  return crypto.createHash("md5").update(stableData).digest("hex");
}

// API untuk ringkasan transaksi
app.get("/api/transactions/summary", async (c) => {
  try {
    const bearer =
      process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "";

    // Get query parameters
    const limit = c.req.query("limit") || "20";
    const offset = c.req.query("offset") || "0";
    const filterBy = c.req.query("filter_by") || "tahun";
    const tahun = c.req.query("tahun") || "2025";
    const bulan = c.req.query("bulan") || "2025-10";
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");

    // Build URL based on filter
    const base = process.env.UPSTREAM_BASE!;
    let url = `${base}/ringkasan_transaksi_snap_konsumen?sort_by=transaksi&order_by=DESC&limit=${limit}&offset=${offset}`;

    if (filterBy === "periode" && tanggalAwal && tanggalAkhir) {
      url += `&filter_by=periode&tanggal_awal=${tanggalAwal}&tanggal_akhir=${tanggalAkhir}`;
    } else if (filterBy === "bulan") {
      url += `&filter_by=bulan&bulan=${bulan}`;
    } else {
      url += `&filter_by=tahun&tahun=${tahun}`;
    }

    console.log(`📊 Fetching transaction summary from: ${url}`);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "dashboard/1.0",
    };
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;

    const res = await fetchWithTimeout(url, 10000, { headers });
    if (!res.ok) throw new Error(`API ${res.status}`);

    const json = await res.json();
    console.log(
      `✅ Transaction summary fetched: ${
        json.data?.total_nota || 0
      } total transactions`
    );

    // Update cache
    dashboardSummaryCache = json;
    lastDashboardSuccessTime = Date.now();

    // Calculate ETag
    const currentETag = calculateDashboardETag(json);

    // Check If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");

    if (ifNoneMatch === currentETag) {
      // Data hasn't changed, return 304
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        lastDashboardSuccessTime
          ? new Date(lastDashboardSuccessTime).toISOString()
          : ""
      );
      return new Response(null, { status: 304 });
    }

    // Data has changed or no If-None-Match, return 200 with full data
    c.header("ETag", currentETag);
    c.header(
      "X-Last-Success",
      lastDashboardSuccessTime
        ? new Date(lastDashboardSuccessTime).toISOString()
        : ""
    );

    return c.json(json);
  } catch (error) {
    console.error("❌ Error fetching transaction summary:", error);

    // Return cached data if available
    if (dashboardSummaryCache) {
      console.log("📦 Returning cached summary data due to error");
      const currentETag = calculateDashboardETag(dashboardSummaryCache);
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        lastDashboardSuccessTime
          ? new Date(lastDashboardSuccessTime).toISOString()
          : ""
      );
      return c.json(dashboardSummaryCache);
    }

    return c.json(
      {
        error: "Failed to fetch transaction summary",
        message: error.message,
        data: { jumlah: 0 },
      },
      500
    );
  }
});

// API untuk detail transaksi
app.get("/api/transactions", async (c) => {
  try {
    const bearer =
      process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "";

    // Get query parameters
    const limit = c.req.query("limit") || "100";
    const offset = c.req.query("offset") || "0";
    const filterBy = c.req.query("filter_by") || "bulan";
    const bulan = c.req.query("bulan") || "2025-10";
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");

    // Handle max limit - if limit is "max", use a reasonable default
    const actualLimit = limit === "max" ? "10000" : limit;

    // Build URL based on filter
    const base = process.env.UPSTREAM_BASE!;
    let url = `${base}/list_transaksi_snap_konsumen?sort_by=transaksi&order_by=DESC&limit=${actualLimit}&offset=${offset}`;

    if (filterBy === "periode" && tanggalAwal && tanggalAkhir) {
      url += `&filter_by=periode&tanggal_awal=${tanggalAwal}&tanggal_akhir=${tanggalAkhir}`;
    } else {
      url += `&filter_by=bulan&bulan=${bulan}`;
    }

    console.log(`📊 Fetching transactions from: ${url}`);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "dashboard/1.0",
    };
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;

    const res = await fetchWithTimeout(url, 10000, { headers });
    if (!res.ok) throw new Error(`API ${res.status}`);

    const json = await res.json();
    console.log(`✅ Transactions fetched: ${json.data?.length || 0} records`);

    // Update cache
    dashboardTransactionsCache = json;
    lastDashboardSuccessTime = Date.now();

    // Calculate ETag
    const currentETag = calculateDashboardETag(json);

    // Check If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");

    if (ifNoneMatch === currentETag) {
      // Data hasn't changed, return 304
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        lastDashboardSuccessTime
          ? new Date(lastDashboardSuccessTime).toISOString()
          : ""
      );
      return new Response(null, { status: 304 });
    }

    // Data has changed or no If-None-Match, return 200 with full data
    c.header("ETag", currentETag);
    c.header(
      "X-Last-Success",
      lastDashboardSuccessTime
        ? new Date(lastDashboardSuccessTime).toISOString()
        : ""
    );

    return c.json(json);
  } catch (error) {
    console.error("❌ Error fetching transactions:", error);

    // Return cached data if available
    if (dashboardTransactionsCache) {
      console.log("📦 Returning cached transactions data due to error");
      const currentETag = calculateDashboardETag(dashboardTransactionsCache);
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        lastDashboardSuccessTime
          ? new Date(lastDashboardSuccessTime).toISOString()
          : ""
      );
      return c.json(dashboardTransactionsCache);
    }

    return c.json(
      {
        error: "Failed to fetch transactions",
        message: error.message,
        data: [],
        jumlah_nota: 0,
      },
      500
    );
  }
});

// API untuk batch detail transaksi (mengambil mesin dan layanan)
app.post("/api/transactions/batch-details", async (c) => {
  try {
    const bearer =
      process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "";
    const base = process.env.UPSTREAM_BASE!;

    // Get request body
    const body = await c.req.json();
    const { ids } = body; // Array of idtransaksi

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json(
        {
          error: "Bad Request",
          message: "ids must be a non-empty array",
        },
        400
      );
    }

    console.log(
      `📊 Fetching batch transaction details for ${ids.length} transactions`
    );

    // Batch processing configuration
    const BATCH_SIZE = 50; // Process 50 requests at a time
    const MAX_RETRIES = 2; // Retry failed requests up to 2 times
    const REQUEST_TIMEOUT = 30000; // 30 seconds timeout per request

    // Helper function to fetch single transaction detail with retry
    const fetchDetailWithRetry = async (
      idtransaksi: string,
      retryCount = 0
    ): Promise<{
      idtransaksi: string;
      mesin: string | null;
      nama_layanan: string | null;
      error?: string;
    }> => {
      try {
        const baseUrl = base.replace(/\/+$/, "");
        const url = `${baseUrl}/data_detail_transaksi_snap?idtransaksi=${encodeURIComponent(
          idtransaksi
        )}`;
        const headers: Record<string, string> = {
          Accept: "application/json",
          "User-Agent": "dashboard/1.0",
        };
        if (bearer) headers["Authorization"] = `Bearer ${bearer}`;

        const res = await fetchWithTimeout(url, REQUEST_TIMEOUT, { headers });
        if (!res.ok) {
          // Retry on server errors (5xx) but not on client errors (4xx)
          if (res.status >= 500 && retryCount < MAX_RETRIES) {
            console.log(
              `Retrying ${idtransaksi} (attempt ${
                retryCount + 1
              }/${MAX_RETRIES}) due to ${res.status}`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * (retryCount + 1))
            ); // Exponential backoff
            return fetchDetailWithRetry(idtransaksi, retryCount + 1);
          }
          console.error(
            `Failed to fetch detail for ${idtransaksi}: ${res.status}`
          );
          return {
            idtransaksi,
            mesin: null,
            nama_layanan: null,
            error: `HTTP ${res.status}`,
          };
        }

        const json = await res.json();
        const rincianLayanan = json.data?.rincian_layanan || [];

        // Extract mesin and nama_layanan from rincian_layanan
        const mesinList: string[] = [];
        const layananList: string[] = [];

        if (Array.isArray(rincianLayanan)) {
          rincianLayanan.forEach((rincian: any) => {
            if (rincian.mesin) {
              mesinList.push(String(rincian.mesin));
            }
            if (rincian.nama_layanan) {
              layananList.push(String(rincian.nama_layanan));
            }
          });
        }

        return {
          idtransaksi,
          mesin: mesinList.length > 0 ? mesinList.join(", ") : null,
          nama_layanan: layananList.length > 0 ? layananList.join(", ") : null,
        };
      } catch (error: any) {
        // Retry on network errors or timeouts
        if (
          (error.name === "AbortError" ||
            error.message?.includes("aborted") ||
            error.message?.includes("timeout")) &&
          retryCount < MAX_RETRIES
        ) {
          console.log(
            `Retrying ${idtransaksi} (attempt ${
              retryCount + 1
            }/${MAX_RETRIES}) due to ${error.message}`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (retryCount + 1))
          ); // Exponential backoff
          return fetchDetailWithRetry(idtransaksi, retryCount + 1);
        }
        console.error(`Error fetching detail for ${idtransaksi}:`, error);
        return {
          idtransaksi,
          mesin: null,
          nama_layanan: null,
          error: error.message || "Unknown error",
        };
      }
    };

    // Process in batches to avoid overwhelming the server
    const details: Array<{
      idtransaksi: string;
      mesin: string | null;
      nama_layanan: string | null;
      error?: string;
    }> = [];

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(ids.length / BATCH_SIZE);

      console.log(
        `📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} transactions)`
      );

      // Process batch in parallel
      const batchPromises = batch.map((idtransaksi) =>
        fetchDetailWithRetry(idtransaksi)
      );
      const batchResults = await Promise.all(batchPromises);
      details.push(...batchResults);

      // Small delay between batches to avoid overwhelming the server
      // Reduced delay for better performance on large datasets
      if (i + BATCH_SIZE < ids.length) {
        await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms delay between batches
      }
    }

    // Count successful vs failed
    const successful = details.filter(
      (d) => d.mesin !== null || d.nama_layanan !== null
    ).length;
    const failed = details.filter((d) => d.error).length;

    console.log(
      `✅ Batch transaction details fetched: ${details.length} records (${successful} successful, ${failed} failed)`
    );

    return c.json({
      success: true,
      data: details,
      total: details.length,
      successful,
      failed,
    });
  } catch (error: any) {
    console.error("❌ Error fetching batch transaction details:", error);
    return c.json(
      {
        error: "Failed to fetch batch transaction details",
        message: error.message,
        data: [],
      },
      500
    );
  }
});

// API untuk detail transaksi berdasarkan idtransaksi
app.get("/api/transaction-detail", async (c) => {
  try {
    const bearer =
      process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "";
    const base = process.env.UPSTREAM_BASE!;
    const idtransaksi = c.req.query("idtransaksi");

    if (!idtransaksi) {
      return c.json(
        {
          error: "Bad Request",
          message: "idtransaksi parameter is required",
        },
        400
      );
    }

    const baseUrl = base.replace(/\/+$/, "");
    const url = `${baseUrl}/data_detail_transaksi_snap?idtransaksi=${encodeURIComponent(
      idtransaksi
    )}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "dashboard/1.0",
    };
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;

    const res = await fetchWithTimeout(url, 10000, { headers });
    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const json = await res.json();
    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error fetching transaction detail:", error);
    return c.json(
      {
        error: "Failed to fetch transaction detail",
        message: error.message,
      },
      500
    );
  }
});

// Leaderboard API endpoints
app.get("/api/leaderboard/frequency", async (c) => {
  try {
    const bearer =
      process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "";
    const base = process.env.UPSTREAM_BASE!;

    // Get query parameters
    const filterBy = c.req.query("filter_by") || "bulan";
    const bulan = c.req.query("bulan") || "2025-10";
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");

    console.log("📊 Generating frequency leaderboard...");

    // Load controller map to get machine IDs
    await loadControllerMap();
    const machineIds = getAllMachineIds();

    const leaderboard = [];

    // Get data for each machine
    for (const machineId of machineIds) {
      try {
        let url = `${base}/list_transaksi_snap_konsumen?sort_by=transaksi&order_by=DESC&limit=1000&offset=0&idmesin=${machineId}`;

        if (filterBy === "periode" && tanggalAwal && tanggalAkhir) {
          url += `&filter_by=periode&tanggal_awal=${tanggalAwal}&tanggal_akhir=${tanggalAkhir}`;
        } else if (filterBy === "bulan") {
          url += `&filter_by=bulan&bulan=${bulan}`;
        } else {
          url += `&filter_by=tahun&tahun=2025`;
        }

        const headers: Record<string, string> = {
          Accept: "application/json",
          "User-Agent": "leaderboard/1.0",
        };
        if (bearer) headers["Authorization"] = `Bearer ${bearer}`;

        const res = await fetchWithTimeout(url, 10000, { headers });
        if (!res.ok) continue;

        const json = await res.json();
        const transactions = json.data || [];

        // Calculate frequency (number of transactions)
        const frequency = transactions.length;

        if (frequency > 0) {
          leaderboard.push({
            machineId,
            machineLabel: controllersMap?.[machineId] || machineId,
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

    const responseData = {
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
      period: { filterBy, bulan, tanggalAwal, tanggalAkhir },
    };

    // Update cache
    frequencyLeaderboardCache = responseData;
    lastLeaderboardSuccessTime = Date.now();

    // Calculate ETag
    const currentETag = calculateLeaderboardETag(responseData);

    // Check If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");

    if (ifNoneMatch === currentETag) {
      // Data hasn't changed, return 304
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        lastLeaderboardSuccessTime
          ? new Date(lastLeaderboardSuccessTime).toISOString()
          : ""
      );
      return new Response(null, { status: 304 });
    }

    // Data has changed or no If-None-Match, return 200 with full data
    c.header("ETag", currentETag);
    c.header(
      "X-Last-Success",
      lastLeaderboardSuccessTime
        ? new Date(lastLeaderboardSuccessTime).toISOString()
        : ""
    );

    return c.json(responseData);
  } catch (error) {
    console.error("❌ Error generating frequency leaderboard:", error);

    // Return cached data if available
    if (frequencyLeaderboardCache) {
      console.log(
        "📦 Returning cached frequency leaderboard data due to error"
      );
      const currentETag = calculateLeaderboardETag(frequencyLeaderboardCache);
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        lastLeaderboardSuccessTime
          ? new Date(lastLeaderboardSuccessTime).toISOString()
          : ""
      );
      return c.json(frequencyLeaderboardCache);
    }

    return c.json(
      {
        success: false,
        error: "Failed to generate frequency leaderboard",
        message: error.message,
      },
      500
    );
  }
});

app.get("/api/leaderboard/revenue", async (c) => {
  try {
    const bearer =
      process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "";
    const base = process.env.UPSTREAM_BASE!;

    // Get query parameters
    const filterBy = c.req.query("filter_by") || "bulan";
    const bulan = c.req.query("bulan") || "2025-10";
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");

    console.log("💰 Generating revenue leaderboard...");

    // Load controller map to get machine IDs
    await loadControllerMap();
    const machineIds = getAllMachineIds();

    const leaderboard = [];

    // Get data for each machine
    for (const machineId of machineIds) {
      try {
        let url = `${base}/list_transaksi_snap_konsumen?sort_by=transaksi&order_by=DESC&limit=1000&offset=0&idmesin=${machineId}`;

        if (filterBy === "periode" && tanggalAwal && tanggalAkhir) {
          url += `&filter_by=periode&tanggal_awal=${tanggalAwal}&tanggal_akhir=${tanggalAkhir}`;
        } else if (filterBy === "bulan") {
          url += `&filter_by=bulan&bulan=${bulan}`;
        } else {
          url += `&filter_by=tahun&tahun=2025`;
        }

        const headers: Record<string, string> = {
          Accept: "application/json",
          "User-Agent": "leaderboard/1.0",
        };
        if (bearer) headers["Authorization"] = `Bearer ${bearer}`;

        const res = await fetchWithTimeout(url, 10000, { headers });
        if (!res.ok) continue;

        const json = await res.json();
        const transactions = json.data || [];

        // Calculate total revenue
        const totalRevenue = transactions.reduce(
          (sum: number, t: any) => sum + (t.total_harga || 0),
          0
        );

        if (totalRevenue > 0) {
          leaderboard.push({
            machineId,
            machineLabel: controllersMap?.[machineId] || machineId,
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

    const responseData = {
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
      period: { filterBy, bulan, tanggalAwal, tanggalAkhir },
    };

    // Update cache
    revenueLeaderboardCache = responseData;
    lastLeaderboardSuccessTime = Date.now();

    // Calculate ETag
    const currentETag = calculateLeaderboardETag(responseData);

    // Check If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");

    if (ifNoneMatch === currentETag) {
      // Data hasn't changed, return 304
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        lastLeaderboardSuccessTime
          ? new Date(lastLeaderboardSuccessTime).toISOString()
          : ""
      );
      return new Response(null, { status: 304 });
    }

    // Data has changed or no If-None-Match, return 200 with full data
    c.header("ETag", currentETag);
    c.header(
      "X-Last-Success",
      lastLeaderboardSuccessTime
        ? new Date(lastLeaderboardSuccessTime).toISOString()
        : ""
    );

    return c.json(responseData);
  } catch (error) {
    console.error("❌ Error generating revenue leaderboard:", error);

    // Return cached data if available
    if (revenueLeaderboardCache) {
      console.log("📦 Returning cached revenue leaderboard data due to error");
      const currentETag = calculateLeaderboardETag(revenueLeaderboardCache);
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        lastLeaderboardSuccessTime
          ? new Date(lastLeaderboardSuccessTime).toISOString()
          : ""
      );
      return c.json(revenueLeaderboardCache);
    }

    return c.json(
      {
        success: false,
        error: "Failed to generate revenue leaderboard",
        message: error.message,
      },
      500
    );
  }
});

// Authentication endpoints
app.post("/api/auth/login", async (c) => {
  try {
    // Check Content-Type header
    const contentType = c.req.header("Content-Type");
    if (!contentType || !contentType.includes("application/json")) {
      return c.json(
        {
          error: "Bad Request",
          message: "Content-Type must be application/json",
        },
        400
      );
    }

    // Parse JSON with better error handling
    let body;
    try {
      body = await c.req.json();
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return c.json(
        { error: "Bad Request", message: "Invalid JSON format" },
        400
      );
    }

    const { username, password } = body;

    if (!username || !password) {
      return c.json(
        { error: "Bad Request", message: "Username and password are required" },
        400
      );
    }

    const user = await authenticateUser(username, password);

    if (!user) {
      return c.json(
        { error: "Unauthorized", message: "Invalid credentials" },
        401
      );
    }

    const token = generateToken(user);

    return c.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return c.json(
      { error: "Internal Server Error", message: "Login failed" },
      500
    );
  }
});

// Protected routes - require authentication
app.use("/api/transactions/*", authMiddleware());
app.use("/api/leaderboard/*", authMiddleware());
app.use("/api/machines/*/start", authMiddleware());
app.use("/api/machines/*/stop", authMiddleware());

// Protected HTML pages - require authentication
app.get("/dashboard", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.redirect("/login?return=/dashboard");
  }

  const token = authHeader.substring(7);
  const { verifyToken } = await import("./auth.js");
  const payload = verifyToken(token);

  if (!payload) {
    return c.redirect("/login?return=/dashboard");
  }

  // Check if user has admin role
  if (payload.role !== "admin") {
    return c.html(
      `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Access Denied</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #e74c3c; }
          .btn { background: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1 class="error">Access Denied</h1>
        <p>You need admin privileges to access the dashboard.</p>
        <a href="/monitor" class="btn">Go to Monitor</a>
      </body>
      </html>
    `,
      403
    );
  }

  try {
    const html = await fs.readFile("dashboard/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Dashboard not found", 404);
  }
});

app.get("/leaderboard", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.redirect("/login?return=/leaderboard");
  }

  const token = authHeader.substring(7);
  const { verifyToken } = await import("./auth.js");
  const payload = verifyToken(token);

  if (!payload) {
    return c.redirect("/login?return=/leaderboard");
  }

  // Check if user has admin role
  if (payload.role !== "admin") {
    return c.html(
      `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Access Denied</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #e74c3c; }
          .btn { background: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1 class="error">Access Denied</h1>
        <p>You need admin privileges to access the leaderboard.</p>
        <a href="/monitor" class="btn">Go to Monitor</a>
      </body>
      </html>
    `,
      403
    );
  }

  try {
    const html = await fs.readFile("leaderboard/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Leaderboard not found", 404);
  }
});

app.get("/monitor", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.redirect("/login?return=/monitor");
  }

  const token = authHeader.substring(7);
  const { verifyToken } = await import("./auth.js");
  const payload = verifyToken(token);

  if (!payload) {
    return c.redirect("/login?return=/monitor");
  }

  try {
    const html = await fs.readFile("monitor/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Monitor not found", 404);
  }
});

// Serve static files
app.get("/login", async (c) => {
  try {
    const html = await fs.readFile("login/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Login page not found", 404);
  }
});

app.get("/styles/*", async (c) => {
  const path = c.req.path.replace("/styles/", "styles/");
  try {
    const content = await fs.readFile(path, "utf8");
    return c.text(content, 200, { "Content-Type": "text/css" });
  } catch (error) {
    return c.text("File not found", 404);
  }
});

app.get("/scripts/*", async (c) => {
  const path = c.req.path.replace("/scripts/", "scripts/");
  try {
    const content = await fs.readFile(path, "utf8");
    return c.text(content, 200, { "Content-Type": "application/javascript" });
  } catch (error) {
    return c.text("File not found", 404);
  }
});

app.get("/assets/*", async (c) => {
  const path = c.req.path.replace("/assets/", "assets/");
  try {
    const content = await fs.readFile(path);
    const ext = path.split(".").pop();
    const contentType =
      ext === "svg" ? "image/svg+xml" : "application/octet-stream";
    return new Response(content, { headers: { "Content-Type": contentType } });
  } catch (error) {
    return c.text("File not found", 404);
  }
});

// Public routes
app.get("/", (c) => c.text("OK"));

await loadControllerMap();
await refresh();
setInterval(refresh, 180000); // 3 menit

serve({ fetch: app.fetch, port: PORT }, () =>
  console.log(`Local API on http://localhost:${PORT}`)
);
