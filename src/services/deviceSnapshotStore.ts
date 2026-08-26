import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

export interface StoredDeviceSnapshot {
  device: any;
  /** Epoch ms at which the gateway recorded this device. */
  ts: number;
}

/**
 * Short on purpose. This is a safety net, not a dependency: if the gateway is
 * slow or down the refresh must still complete on Smartlink data alone.
 */
const TIMEOUT_MS = 1500;

/**
 * Push the populated device records seen this refresh to the gateway and ask it
 * for the last known record of the ones that came back blank.
 *
 * Vercel gives each request a fresh lambda, so the monitor cannot remember
 * anything between refreshes on its own — the gateway (VPS, Redis) is the only
 * durable place to keep "what did this machine look like when we last had real
 * data". See machineService.repairBlankRecords for how the answer is used.
 *
 * Returns {} on any failure — a missing safety net degrades to the previous
 * behaviour, it never breaks a refresh.
 */
export async function syncDeviceSnapshots(
  good: Record<string, any>,
  need: string[]
): Promise<Record<string, StoredDeviceSnapshot>> {
  const secret = process.env.MONITOR_INGEST_SECRET;
  if (!secret) return {};
  if (Object.keys(good).length === 0 && need.length === 0) return {};

  try {
    const res = await fetchWithTimeout(
      `${config.eventGateway.base}/api/monitoring/device-snapshot`,
      TIMEOUT_MS,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Monitor-Ingest-Secret": secret,
        },
        body: JSON.stringify({ good, need }),
      }
    );
    if (!res.ok) {
      console.warn(
        `[DeviceSnapshot] gateway responded ${res.status}; running without the last-known-good net`
      );
      return {};
    }
    const json: any = await res.json();
    return json?.data?.known ?? {};
  } catch (error: any) {
    console.warn(
      `[DeviceSnapshot] gateway unreachable (${error?.message}); running without the last-known-good net`
    );
    return {};
  }
}
