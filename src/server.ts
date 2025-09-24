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
    // console.log(list);
    // console.log(summary);
    // console.log(json);

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

  return c.json(currentSnapshot);
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
await refresh();
setInterval(refresh, 180000); // 3 menit

serve({ fetch: app.fetch, port: PORT }, () =>
  console.log(`Local API on http://localhost:${PORT}`)
);
