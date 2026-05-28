import { config } from "../config.js";
import { fetchWithTimeout, createUpstreamHeaders } from "../utils/fetch.js";

/**
 * Session cache untuk RUNNING machines.
 * Tujuan: hindari fetch detail_snap_mesin tiap refresh cycle.
 *
 * Key = aid (transaction id). Aid berubah = session baru = invalidate.
 * Entry menyimpan baseline (dur, tl_baseline, fetched_at) untuk extrapolasi elapsed.
 *
 * elapsed_now = (dur - tl_baseline) + (now - fetched_at), clamp ke [0, dur]
 */

export interface SessionEntry {
  aid: string;
  machineId: string;
  dur: number;
  tl_baseline: number;
  fetched_at: number;
}

const sessions: Map<string, SessionEntry> = new Map(); // key = aid
const inflight: Set<string> = new Set(); // key = aid, prevent concurrent fetch

/**
 * Monotonic floor per aid. elapsed yg di-return ke caller tidak boleh
 * lebih kecil dari nilai terakhir untuk aid yg sama. Safety net untuk
 * kasus2 baseline regress (cache evict+reseed, fallback path, smartlink
 * stale tl yg lolos guard, dll).
 */
const lastKnownElapsed: Map<string, number> = new Map(); // key = aid

const RESYNC_INTERVAL_MS = 90_000; // resync tiap 90s
const FETCH_TIMEOUT_MS = 3_000;

/**
 * Lookup entry by aid. Returns null if not cached yet.
 */
export function getSession(aid: string | null | undefined): SessionEntry | null {
  if (!aid) return null;
  return sessions.get(aid) || null;
}

/**
 * Compute extrapolated elapsed_ms for given aid.
 * Returns null if no cache entry (caller harus fallback).
 */
export function computeElapsed(aid: string | null | undefined): {
  elapsed_ms: number;
  start_time: number;
} | null {
  const entry = getSession(aid);
  if (!entry) return null;

  const now = Date.now();
  const baselineElapsed = Math.max(0, entry.dur - entry.tl_baseline);
  const drift = Math.max(0, now - entry.fetched_at);
  const rawElapsed = Math.min(entry.dur, baselineElapsed + drift);

  // Monotonic floor: tidak boleh lebih kecil dari yg pernah ditampilkan
  // untuk aid ini. Clamp tetap ke dur (selesai = stop di max).
  const lastKnown = lastKnownElapsed.get(entry.aid) ?? 0;
  const elapsed = Math.min(entry.dur, Math.max(rawElapsed, lastKnown));
  lastKnownElapsed.set(entry.aid, elapsed);

  const start_time = now - elapsed;

  return {
    elapsed_ms: Math.round(elapsed),
    start_time,
  };
}

/**
 * Fetch detail_snap_mesin untuk satu machine, update cache.
 */
async function fetchAndCache(
  machineId: string,
  aid: string,
  durFallback: number
): Promise<void> {
  if (inflight.has(aid)) return;
  inflight.add(aid);

  try {
    const base = config.upstream.base;
    const outlet = config.upstream.outletId;
    const url = `${base}/detail_snap_mesin?idoutlet=${encodeURIComponent(
      outlet
    )}&idsnap_mesin=${encodeURIComponent(machineId)}`;

    const headers = {
      ...createUpstreamHeaders(config.upstream.bearer, "session-cache/1.0"),
      Origin: "https://dashboard-vue.smartlink.id",
      Referer: "https://dashboard-vue.smartlink.id",
    };

    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, { headers });
    if (!res.ok) {
      console.warn(
        `[SessionCache] detail_snap_mesin ${machineId} returned ${res.status}`
      );
      return;
    }

    const json: any = await res.json();
    const device = json?.data?.snap_report_device;
    if (!device) {
      console.warn(`[SessionCache] No snap_report_device in detail for ${machineId}`);
      return;
    }

    const detailAid = device.aid;
    if (!detailAid || detailAid !== aid) {
      console.log(
        `[SessionCache] Aid mismatch for ${machineId}: list=${aid} detail=${detailAid}. Skip cache update.`
      );
      return;
    }

    const tl = Number(device.tl ?? 0);
    const dur = Number(device.dur ?? durFallback);

    if (dur <= 0) {
      console.warn(`[SessionCache] Invalid dur for ${machineId}: ${dur}`);
      return;
    }

    const now = Date.now();

    // Monotonic guard: tolak update kalau bikin elapsed regress.
    // Smartlink kadang return cached/stale tl saat resync -> tanpa guard,
    // elapsed bisa loncat mundur. Toleransi 5s untuk noise jitter.
    const existing = sessions.get(aid);
    if (existing) {
      const currentExtrapolated =
        existing.dur - existing.tl_baseline + (now - existing.fetched_at);
      const newBaselineElapsed = dur - tl;

      if (newBaselineElapsed < currentExtrapolated - 5000) {
        // Stale data dari smartlink. Skip overwrite baseline,
        // tapi extend fetched_at supaya tidak resync ulang segera.
        sessions.set(aid, { ...existing, fetched_at: now });
        console.log(
          `[SessionCache] Stale tl untuk ${machineId} (aid=${aid}): newBaseline=${newBaselineElapsed}ms vs current=${currentExtrapolated}ms. Skip overwrite.`
        );
        return;
      }
    }

    sessions.set(aid, {
      aid,
      machineId,
      dur,
      tl_baseline: tl,
      fetched_at: now,
    });
  } catch (err: any) {
    console.warn(
      `[SessionCache] Fetch failed for ${machineId} (aid=${aid}):`,
      err?.message || err
    );
  } finally {
    inflight.delete(aid);
  }
}

/**
 * Sync session cache untuk daftar RUNNING machines.
 * - Fetch detail untuk aid baru
 * - Resync untuk entry yg sudah > RESYNC_INTERVAL_MS
 * - Evict entry yg aid-nya tidak lagi di running list
 *
 * Non-blocking: fire-and-forget per machine, returns immediately.
 */
export function syncRunningSessions(
  running: Array<{ id: string; aid: string; dur: number }>
): void {
  const now = Date.now();
  const activeAids = new Set<string>();

  for (const m of running) {
    if (!m.aid) continue;
    activeAids.add(m.aid);

    const entry = sessions.get(m.aid);
    const needsFetch =
      !entry || now - entry.fetched_at > RESYNC_INTERVAL_MS;

    if (needsFetch) {
      // Fire-and-forget; cache populated by next refresh cycle
      fetchAndCache(m.id, m.aid, m.dur);
    }
  }

  // Evict expired sessions (aid no longer in running list).
  // Hapus juga lastKnownElapsed supaya tidak memory leak — aid yg gone
  // berarti session selesai, monotonic floor tidak relevan lagi.
  for (const aid of sessions.keys()) {
    if (!activeAids.has(aid)) {
      sessions.delete(aid);
      lastKnownElapsed.delete(aid);
    }
  }
}

/**
 * Test/debug helper.
 */
export function _debug_getSessionsSnapshot(): SessionEntry[] {
  return Array.from(sessions.values());
}
