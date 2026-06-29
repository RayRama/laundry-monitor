import { normalize } from "../normalize.js";
import { MACHINE_CONFIG } from "../constants.js";
import { config } from "../config.js";
import { fetchWithTimeout, createUpstreamHeaders } from "../utils/fetch.js";
import { machineCache } from "../utils/cache.js";
import type { MachineSnapshot } from "../types.js";

const MAX_DURATION_MS = 3 * 60 * 60 * 1000;

function isUsableTl(tl: number, dur: number): boolean {
  return tl > 0 && dur > 0 && tl <= dur && dur <= MAX_DURATION_MS;
}

/**
 * Fetch detail_snap_mesin for one machine, return {tl, dur}.
 * Used as inline fallback when list endpoint tl is invalid.
 */
async function fetchDetailTlDur(
  machineId: string,
  timeoutMs: number
): Promise<{ tl: number; dur: number } | null> {
  try {
    const base = config.upstream.base;
    const outlet = config.upstream.outletId;
    const url = `${base}/detail_snap_mesin?idoutlet=${encodeURIComponent(
      outlet
    )}&idsnap_mesin=${encodeURIComponent(machineId)}`;
    const headers = {
      ...createUpstreamHeaders(config.upstream.bearer, "detail-fallback/1.0"),
      Origin: "https://dashboard-vue.smartlink.id",
      Referer: "https://dashboard-vue.smartlink.id",
    };
    const res = await fetchWithTimeout(url, timeoutMs, { headers });
    if (!res.ok) return null;
    const json: any = await res.json();
    const device = json?.data?.snap_report_device;
    if (!device) return null;
    return {
      tl: Number(device.tl ?? 0),
      dur: Number(device.dur ?? 0),
    };
  } catch {
    return null;
  }
}

let controllersMap: Record<string, string> | null = null;

/**
 * Load controller map dari constants
 */
export async function loadControllerMap(): Promise<void> {
  controllersMap = MACHINE_CONFIG.machineLabels;
  console.log(
    "✅ Controller map loaded:",
    Object.keys(controllersMap || {}).length,
    "machines"
  );
}

/**
 * Check if data is stale based on last success time
 * Stale = true jika sudah lewat threshold tanpa sukses refresh
 */
export function isDataStale(): boolean {
  const snapshot = machineCache.get();
  if (!snapshot?.meta?.ts) return true;

  // Check if meta already marks as stale
  if (snapshot.meta.stale) return true;

  const lastUpdate = new Date(snapshot.meta.ts).getTime();
  const now = Date.now();
  return now - lastUpdate > config.refresh.staleThreshold;
}

/**
 * Refresh machine data dari upstream API
 */
export async function refreshMachines(): Promise<void> {
  const base = config.upstream.base;
  const outlet = config.upstream.outletId;
  const url = `${base}/list_snap_mesin?idoutlet=${encodeURIComponent(
    outlet
  )}&offset=0&limit=25`;
  const timeout = config.upstream.timeout;

  try {
    const headers = createUpstreamHeaders(
      config.upstream.bearer,
      "machines-local-fixed-slots/1.0"
    );

    const res = await fetchWithTimeout(url, timeout, { headers });
    if (!res.ok) throw new Error(`upstream ${res.status}`);

    const json = await res.json();
    const rows = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
      ? json
      : [];

    const { list, summary } = normalize(rows, controllersMap);

    // Inline fallback: RUNNING machines yg tidak dapat elapsed_ms dari list
    // payload (tl invalid). Fetch detail_snap_mesin synchronously per mesin
    // dalam request yg sama. Vercel serverless = no shared memory, harus
    // resolve dalam single request.
    const needsDetail = list
      .filter((m) => m.status === "RUNNING" && m.elapsed_ms === undefined);

    if (needsDetail.length > 0) {
      const detailTimeoutMs = Math.min(timeout, 2500);
      const detailResults = await Promise.allSettled(
        needsDetail.map((m) => fetchDetailTlDur(m.id, detailTimeoutMs))
      );
      const now = Date.now();
      needsDetail.forEach((m, i) => {
        const r = detailResults[i];
        if (r && r.status === "fulfilled" && r.value) {
          const { tl, dur } = r.value;
          if (isUsableTl(tl, dur)) {
            const idx = list.findIndex((x) => x.id === m.id);
            if (idx >= 0) {
              list[idx] = {
                ...list[idx],
                elapsed_ms: Math.round(dur - tl),
                start_time: now,
              };
            }
          }
        }
      });
    }

    // Update cache dengan snapshot baru
    const snapshot: MachineSnapshot = {
      machines: list,
      summary,
      meta: {
        ts: new Date().toISOString(),
        stale: false,
        version: "v1",
      },
    };

    machineCache.set(snapshot);
  } catch (e) {
    const existingSnapshot = machineCache.get();
    if (existingSnapshot) {
      // Update timestamp tapi mark as stale
      const updatedSnapshot: MachineSnapshot = {
        ...existingSnapshot,
        meta: {
          ...existingSnapshot.meta,
          ts: new Date().toISOString(),
          stale: isDataStale(),
        },
      };
      machineCache.set(updatedSnapshot);
    } else {
      // Create empty snapshot jika belum ada
      const now = new Date().toISOString();
      const emptySnapshot: MachineSnapshot = {
        machines: [],
        summary: {
          dryer: { total: 0, ready: 0, running: 0, offline: 0 },
          washer: { total: 0, ready: 0, running: 0, offline: 0 },
        },
        meta: { ts: now, stale: true, version: "v1" },
      };
      machineCache.set(emptySnapshot);
    }
  }
}

/**
 * Get machine label dari machine ID
 */
export function getMachineLabel(machineId: string): string {
  return controllersMap?.[machineId] || machineId;
}
