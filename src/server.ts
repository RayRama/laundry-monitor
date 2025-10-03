import dotenv from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { normalize } from "./normalize.js";
import { SpreadsheetManager } from "./spreadsheet.js";

// State management untuk mesin
const machineStates = new Map<
  string,
  {
    status: string;
    uniqueKey?: string;
    lastUpdate: number;
  }
>();

// Auto-cleanup state yang sudah lama (lebih dari 1 jam 5 menit)
setInterval(() => {
  const now = Date.now();
  const oneHourFiveMinutesAgo = now - 60 * 60 * 1000 - 5 * 60 * 1000; // 1 jam + 5 menit

  for (const [machineId, state] of machineStates.entries()) {
    if (state.lastUpdate < oneHourFiveMinutesAgo) {
      machineStates.delete(machineId);
      console.log(`🧹 Cleaned up old state for machine: ${machineId}`);
    }
  }
}, 30 * 60 * 1000); // Check every 30 minutes

/**
 * Update machine state dan generate UUID hanya saat status change
 */
function updateMachineState(machineId: string, newStatus: string): string {
  const current = machineStates.get(machineId);
  const now = Date.now();

  if (!current) {
    // Mesin baru
    const uniqueKey = newStatus === "RUNNING" ? crypto.randomUUID() : undefined;
    machineStates.set(machineId, {
      status: newStatus,
      uniqueKey,
      lastUpdate: now,
    });
    return uniqueKey || "none";
  }

  if (current.status !== newStatus) {
    // Status berubah
    if (newStatus === "RUNNING") {
      // Mulai running → Generate UUID baru
      const uniqueKey = crypto.randomUUID();
      machineStates.set(machineId, {
        status: newStatus,
        uniqueKey,
        lastUpdate: now,
      });
      return uniqueKey;
    } else {
      // Selesai running → Hapus UUID
      machineStates.set(machineId, {
        status: newStatus,
        uniqueKey: undefined,
        lastUpdate: now,
      });
      return "none";
    }
  }

  // Status sama, return existing uniqueKey
  return current.uniqueKey || "none";
}

// Load env dari .env.local (jika ada) lalu fallback ke .env
dotenv.config({ path: ".env.local" });
dotenv.config();

const app = new Hono();
app.use("*", cors());
const PORT = 3000;

let controllersMap: Record<string, string> | null = null;
let snapshot: any = null;
let lastSuccessTime: number | null = null;
let spreadsheetManager: SpreadsheetManager | null = null;

async function loadControllerMap() {
  const path = process.env.CONTROLLER_MAP_FILE || "";
  if (!path) {
    controllersMap = null;
    return;
  }
  try {
    const raw = await fs.readFile(path, "utf8");
    controllersMap = JSON.parse(raw); // {"807D3A4E5A46":"W6","2509BCA000360460945":"W6", ...}
  } catch {
    controllersMap = null;
  }
}

async function setupSpreadsheet() {
  console.log("🔧 Starting Google Sheets setup...");
  
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;

  console.log(`📊 Spreadsheet ID: ${spreadsheetId ? 'SET' : 'MISSING'}`);
  console.log(`📊 Credentials JSON: ${credentialsJson ? 'SET' : 'MISSING'}`);
  console.log(`📊 Credentials Path: ${credentialsPath ? 'SET' : 'MISSING'}`);

  if (!spreadsheetId) {
    console.log(
      "⚠️  Google Sheets not configured (missing GOOGLE_SPREADSHEET_ID)"
    );
    return;
  }

  try {
    let credentials;

    // Priority: Use JSON string from environment variable (for Vercel)
    if (credentialsJson) {
      credentials = JSON.parse(credentialsJson);
      console.log("📊 Using credentials from GOOGLE_CREDENTIALS_JSON");
    }
    // Fallback: Use file path (for local development)
    else if (credentialsPath) {
      credentials = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
      console.log("📁 Using credentials from file path");
    } else {
      console.log(
        "⚠️  Google Sheets not configured (missing GOOGLE_CREDENTIALS_JSON or GOOGLE_CREDENTIALS_PATH)"
      );
      return;
    }

    spreadsheetManager = new SpreadsheetManager(spreadsheetId, credentials);

    // Setup headers di spreadsheet
    await spreadsheetManager.setupHeaders();

    console.log("✅ Google Sheets integration initialized");
  } catch (error) {
    console.error("❌ Failed to setup Google Sheets:", error);
    spreadsheetManager = null;
  }
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
  const url = `${base}?idoutlet=${encodeURIComponent(
    outlet
  )}&offset=0&limit=25`;
  // console.log(url);
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
    // console.log(res);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
      ? json
      : [];
    const { list, summary } = normalize(rows, controllersMap);

    // Update machine states dan generate uniqueKey
    const machinesWithKeys = list.map((machine) => {
      const uniqueKey = updateMachineState(machine.label, machine.status);
      return {
        ...machine,
        uniqueKey: uniqueKey,
      };
    });

    // Filter hanya mesin yang running untuk spreadsheet
    const runningMachines = machinesWithKeys.filter(
      (m) => m.uniqueKey !== "none"
    );

    // console.log(list);
    // console.log(summary);
    // console.log(json);

    // Update last success time on successful refresh
    lastSuccessTime = Date.now();

    snapshot = {
      machines: machinesWithKeys, // Include uniqueKey di response
      summary,
      meta: {
        ts: new Date().toISOString(),
        stale: false,
        version: "v1",
      },
    };

    // Track machine status changes for spreadsheet
    console.log(
      `🔍 SpreadsheetManager status: ${
        spreadsheetManager ? "initialized" : "null"
      }`
    );
    console.log(`🔍 Running machines count: ${runningMachines.length}`);

    if (spreadsheetManager) {
      try {
        console.log(
          `📝 Attempting to track ${runningMachines.length} running machines:`,
          runningMachines.map((m) => ({
            id: m.id,
            status: m.status,
            uniqueKey: m.uniqueKey,
            aid: m.aid,
          }))
        );
        await spreadsheetManager.trackMachineStatus(runningMachines);
        console.log("✅ Machine status tracking completed.");
      } catch (error) {
        console.error("❌ Error tracking machine status:", error);
      }
    } else {
      console.log("⚠️ SpreadsheetManager is not initialized");
    }
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
app.get("/", (c) => c.text("OK"));

await loadControllerMap();
await setupSpreadsheet();
await refresh();
setInterval(refresh, 180000); // 3 menit

serve({ fetch: app.fetch, port: PORT }, () =>
  console.log(`Local API on http://localhost:${PORT}`)
);
