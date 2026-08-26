import { normalize, isBlankDeviceRecord } from "../normalize.js";
import { MACHINE_CONFIG } from "../constants.js";
import { config } from "../config.js";
import { fetchWithTimeout, createUpstreamHeaders } from "../utils/fetch.js";
import { machineCache } from "../utils/cache.js";
import {
  syncDeviceSnapshots,
  type StoredDeviceSnapshot,
} from "./deviceSnapshotStore.js";
import type { MachineSnapshot } from "../types.js";

const MAX_DURATION_MS = 3 * 60 * 60 * 1000;

function isUsableTl(tl: number, dur: number): boolean {
  return tl > 0 && dur > 0 && tl <= dur && dur <= MAX_DURATION_MS;
}

/**
 * Fetch detail_snap_mesin for one machine and return its raw
 * `snap_report_device`, or null when the call fails.
 */
async function fetchDetailDevice(
  machineId: string,
  timeoutMs: number
): Promise<any | null> {
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
    return json?.data?.snap_report_device ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch detail_snap_mesin for one machine, return {tl, dur}.
 * Used as inline fallback when list endpoint tl is invalid.
 */
async function fetchDetailTlDur(
  machineId: string,
  timeoutMs: number
): Promise<{ tl: number; dur: number } | null> {
  const device = await fetchDetailDevice(machineId, timeoutMs);
  if (!device) return null;
  return { tl: Number(device.tl ?? 0), dur: Number(device.dur ?? 0) };
}

/**
 * How long a machine may be held at its last known state while Smartlink is
 * handing back blank records.
 *
 * Blank episodes measured on 2026-08-26 ran tens of seconds and could cover both
 * endpoints at once. Five minutes rides those out comfortably while still letting
 * a machine that is genuinely unplugged fall through to OFFLINE.
 */
const HOLD_LAST_KNOWN_MS = 5 * 60 * 1000;

/**
 * Turn a stored record into what the machine most likely looks like right now.
 *
 * A held record must not freeze the timer: if the machine was mid-cycle when we
 * last had real data, `tl` is advanced by the elapsed wall time so the countdown
 * keeps running through the gap. If the cycle would have finished during the gap,
 * the machine is handed back idle rather than stuck at 0.
 *
 * Returns null when the record is too old to stand in for live data.
 */
function projectKnownDevice(
  entry: StoredDeviceSnapshot,
  now: number
): any | null {
  const age = now - Number(entry?.ts ?? 0);
  if (!Number.isFinite(age) || age < 0 || age > HOLD_LAST_KNOWN_MS) return null;
  if (!entry?.device || isBlankDeviceRecord(entry.device)) return null;

  const device = { ...entry.device };
  const tl = Number(device.tl ?? 0);
  const dur = Number(device.dur ?? 0);

  if (tl > 0 && dur > 0) {
    const remaining = tl - age;
    if (remaining > 0) return { ...device, tl: remaining };
    return { ...device, tl: 0, dur: 0, sw: false, st: 0, aid: "" };
  }
  return { ...device, tl: 0, dur: 0 };
}

/**
 * Repair rows whose `snap_report_device` came back as a blank placeholder.
 *
 * Smartlink serves an all-zero record (`ol:false` included) at random for
 * machines that are perfectly healthy - see isBlankDeviceRecord in normalize.ts
 * for the measurements. Taken at face value it paints live machines OFFLINE.
 *
 * Two stages, cheapest first:
 *
 *  1. Re-read every blank row from detail_snap_mesin. A populated record in
 *     EITHER endpoint proves the machine is up, so the row is patched with real
 *     data. 9 parallel detail calls measured at 528ms total.
 *
 *  2. Whatever is still blank goes to the gateway snapshot store, which also
 *     receives this refresh's good records. Blank episodes can cover both
 *     Smartlink endpoints at the same time, so stage 1 alone cannot clear every
 *     false OFFLINE; holding the machine at its last known state for up to
 *     HOLD_LAST_KNOWN_MS does. The gateway is optional - if it is unreachable or
 *     MONITOR_INGEST_SECRET is unset, this degrades to stage 1 only.
 *
 * A row that is still blank after both stages is genuinely down and classifies
 * OFFLINE.
 */
async function repairBlankRecords(
  rows: any[],
  timeoutMs: number
): Promise<void> {
  const isBlankRow = (x: any) =>
    x?.id && isBlankDeviceRecord(x?.snap_report_device);

  // Stage 1 - cross-check against detail_snap_mesin.
  const blankRows = rows.filter(isBlankRow);
  if (blankRows.length > 0) {
    const results = await Promise.allSettled(
      blankRows.map((x) => fetchDetailDevice(String(x.id), timeoutMs))
    );
    blankRows.forEach((row, i) => {
      const r = results[i];
      const device = r && r.status === "fulfilled" ? r.value : null;
      if (device && !isBlankDeviceRecord(device)) {
        row.snap_report_device = device;
      }
    });
  }

  // Stage 2 - push what is good, hold what is still blank.
  const good: Record<string, any> = {};
  const need: string[] = [];
  for (const row of rows) {
    if (!row?.id) continue;
    if (isBlankRow(row)) need.push(String(row.id));
    else good[String(row.id)] = row.snap_report_device;
  }

  const known = await syncDeviceSnapshots(good, need);
  if (Object.keys(known).length === 0) return;

  const now = Date.now();
  for (const row of rows) {
    if (!isBlankRow(row)) continue;
    const projected = projectKnownDevice(known[String(row.id)], now);
    if (projected) row.snap_report_device = projected;
  }
}

let controllersMap: Record<string, string> | null = null;
let machineRefreshPromise: Promise<void> | null = null;
let lastFailureAt = 0;

/**
 * How long to stop retrying after a failed refresh.
 *
 * The route awaits refreshMachines() now, and a failed refresh leaves the
 * snapshot flagged stale, which makes the next request try again. With an
 * upstream that is down rather than slow, every request would pay the full
 * UPSTREAM_TIMEOUT_MS. Hold off for a beat and serve the stale-flagged
 * snapshot instead - the client already renders that state.
 */
const FAILURE_BACKOFF_MS = 10_000;

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
async function performMachineRefresh(): Promise<void> {
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

    // Repair blank placeholder records BEFORE classifying, otherwise a random
    // Smartlink blank turns a live machine OFFLINE. See repairBlankRecords.
    await repairBlankRecords(rows, Math.min(timeout, 2500));

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
    machineCache.markSuccess();
    lastFailureAt = 0;
  } catch (e) {
    lastFailureAt = Date.now();
    const existingSnapshot = machineCache.get();
    if (existingSnapshot) {
      // Mark stale, and KEEP `meta.ts` at the last successful refresh.
      //
      // The old code bumped `ts` to now and derived `stale` from isDataStale().
      // Both were wrong: the bumped `ts` made "Terakhir diperbarui" display a
      // fresh clock over stale data, and because isDataStale() measures against
      // that same `ts`, every failure reset the staleness window - so the
      // threshold could never elapse and the badge fired at random instead of
      // tracking the real age of the data. An upstream failure means the served
      // snapshot is stale by definition; say so directly.
      const updatedSnapshot: MachineSnapshot = {
        ...existingSnapshot,
        meta: {
          ...existingSnapshot.meta,
          stale: true,
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

export function refreshMachines(): Promise<void> {
  // Back off after a failure, but only while a snapshot exists to serve.
  // With no snapshot at all there is nothing to fall back to, so keep trying.
  if (
    machineCache.get() &&
    lastFailureAt > 0 &&
    Date.now() - lastFailureAt < FAILURE_BACKOFF_MS
  ) {
    return Promise.resolve();
  }

  if (!machineRefreshPromise) {
    machineRefreshPromise = performMachineRefresh().finally(() => {
      machineRefreshPromise = null;
    });
  }
  return machineRefreshPromise;
}

/**
 * Get machine label dari machine ID
 */
export function getMachineLabel(machineId: string): string {
  return controllersMap?.[machineId] || machineId;
}
