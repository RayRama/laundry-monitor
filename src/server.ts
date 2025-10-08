import dotenv from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { normalize } from "./normalize.js";

// Load env dari .env.local (jika ada) lalu fallback ke .env
dotenv.config({ path: ".env.local" });
dotenv.config();

const app = new Hono();
app.use("*", cors());
const PORT = 3000;

let controllersMap: Record<string, string> | null = null;
let snapshot: any = null;
let lastSuccessTime: number | null = null;

async function loadControllerMap() {
  // Hardcoded controller map to avoid file system issues in Vercel
  controllersMap = {
    "D48AFC354603": "D05",
    "D48AFC325A64": "D07",
    "2CF4321072A5": "D01",
    "68C63AFC13FA": "D02",
    "483FDA643B85": "D03",
    "48E7296DE4BF": "D04",
    "D48AFC35465C": "D06",
    "D48AFC31F4C0": "D08",
    "D48AFC354357": "D09",
    "BCDDC248DF58": "D10",
    "C82B961E9BF3": "D11",
    "8CCE4EF44A99": "D12",
    "9C9C1F410120": "W01",
    "98F4ABD8506A": "W02",
    "8CAAB5D53E39": "W03",
    "84F3EB6ED32F": "W04",
    "483FDA69F7C5": "W05",
    "483FDA077794": "W06",
    "807D3A4E5A46": "W07",
    "5CCF7FDBB498": "W08",
    "483FDA6AFDC7": "W10",
    "500291EB8F36": "W09",
    "A4CF12F307D1": "W11",
    "68C63AFC1863": "W12"
  };
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
    const actualLimit = limit === "max" ? "1000" : limit;

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
    const machineIds = Object.keys(controllersMap || {});

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
    const machineIds = Object.keys(controllersMap || {});

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

app.get("/", (c) => c.text("OK"));

await loadControllerMap();
await refresh();
setInterval(refresh, 180000); // 3 menit

serve({ fetch: app.fetch, port: PORT }, () =>
  console.log(`Local API on http://localhost:${PORT}`)
);
