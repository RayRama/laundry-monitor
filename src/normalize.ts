export type Up = any;
export type Out = {
  id: string;
  type: "washer" | "dryer";
  label: string; // W01..W12 / D01..D12
  slot: string; // div*
  status: "READY" | "RUNNING" | "OFFLINE";
  updated_at: string | null;
  elapsed_ms?: number; // Elapsed time in milliseconds (for RUNNING machines)
  start_time?: number; // Start time in milliseconds (for RUNNING machines)
  aid?: string; // Aid status for trigger mapping (BOS, PAYMENT, etc.)
};

const HYST_MS = Number(process.env.HYST_MS || 3000);
const lastStatus: Map<string, { status: Out["status"]; ts: number }> =
  new Map();

// Store start times for running machines
const startTimes: Map<string, number> = new Map();

// Track previous device state untuk comparison dan logging
const previousDeviceStates: Map<
  string,
  { status: string; device: any; timestamp: number }
> = new Map();

/** Zero-pad helper: 7 -> "07" */
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Calculate elapsed time since updated_at for running machines (stopwatch) */
function calculateElapsed(
  ctrlId: string,
  status: Out["status"],
  updated_at: string | null,
  device: any
): { elapsed_ms?: number; start_time?: number } {
  if (status !== "RUNNING" || !updated_at) {
    // Clear start time when not running
    startTimes.delete(ctrlId);
    return {};
  }

  const now = Date.now();
  const updatedAtMs = new Date(updated_at).getTime();
  const tl = Number(device?.tl ?? 0); // waktu tersisa dalam ms
  const dur = Number(device?.dur ?? 0); // durasi total dalam ms

  // Validasi: jika tl atau dur tidak valid, jangan hitung elapsed
  if (tl <= 0 || dur <= 0 || tl > dur) {
    startTimes.delete(ctrlId);
    return {};
  }

  // Hitung elapsed time berdasarkan durasi - waktu tersisa
  // elapsed = dur - tl (waktu yang sudah berjalan)
  const elapsed = Math.max(0, dur - tl);

  // Validasi: elapsed tidak boleh lebih dari durasi total
  const maxElapsed = Math.min(elapsed, dur);

  // Get or set start time (use current time as fallback if updated_at is not reliable)
  let startTime = startTimes.get(ctrlId);
  if (!startTime) {
    // Use updated_at if available and recent, otherwise use current time
    const now = Date.now();
    const dataAge = updatedAtMs ? now - updatedAtMs : Infinity;

    // If updated_at is too old (> 5 minutes), use current time
    if (dataAge > 5 * 60 * 1000) {
      startTime = now;
      console.log(
        `Using current time for ${ctrlId} (updated_at too old: ${Math.round(
          dataAge / 1000
        )}s)`
      );
    } else {
      startTime = updatedAtMs || now;
    }
    startTimes.set(ctrlId, startTime);
  }

  return {
    elapsed_ms: Math.round(maxElapsed),
    start_time: startTime,
  };
}

/** Normalisasi label ke zero-padded */
function normalizeLabel(raw: string): string {
  // Jika label sudah spesifik (mengandung spasi atau teks tambahan), jangan ubah
  // Contoh: "W09 testing" -> tetap "W09 testing"
  if (raw && raw.includes(" ")) {
    return raw;
  }

  // terima variasi "W7"/"W07"/"Washer 7", "D10"/"Dryer 10" -> jadi W07/D10
  const m = (raw || "").match(/(w|washer|d|dryer)\s*0?(\d{1,2})/i);
  if (!m) return raw; // biarkan; nanti jatuh ke div0
  const isDryer = m[1].toLowerCase().startsWith("d");
  const num = pad2(Number(m[2]));
  return (isDryer ? "D" : "W") + num;
}

/** Ambil label dari controllers.json (jika ada), kalau tidak dari nama, kalau tidak fallback index */
function resolveLabel(
  ctrlId: string,
  name: string,
  jenis: number,
  idxD: number,
  idxW: number,
  ctrlMap: Record<string, string> | null
) {
  let raw = "";
  if (ctrlMap && ctrlMap[ctrlId]) raw = ctrlMap[ctrlId]; // bisa "W7" atau "W07"
  if (!raw) {
    const m = (name || "").match(/(washer|dryer)\s*(\d{1,2})/i);
    if (m) raw = (m[1].toLowerCase().startsWith("dryer") ? "D" : "W") + m[2];
  }
  if (!raw) {
    // fallback index per tipe
    const n = jenis === 2 ? idxD : idxW;
    raw = (jenis === 2 ? "D" : "W") + n;
  }
  return normalizeLabel(raw);
}

/** RULE STATUS (baru, ketat) dengan classification reason */
function classifyNewWithReason(
  device: any,
  updated_at: string | null,
  ctrlId?: string
): { status: Out["status"]; reason: string; details: any } {
  const ol = !!device?.ol;
  const tl = Number(device?.tl ?? 0); // ms
  const dur = Number(device?.dur ?? 0); // ms
  // const door = !!device?.door;
  // const sw = !!device?.sw;
  const st = Number(device?.st ?? 0);
  const aid = device?.aid || null;

  // Capture raw data untuk logging
  const rawData = {
    ol: device?.ol ?? null,
    tl: device?.tl ?? null,
    dur: device?.dur ?? null,
    st: device?.st ?? null,
    aid: device?.aid ?? null,
    door: device?.door ?? null,
    sw: device?.sw ?? null,
    pow: device?.pow ?? null,
  };

  // OFFLINE: device.ol = false
  if (!ol) {
    return {
      status: "OFFLINE",
      reason: "device.ol = false",
      details: {
        ol_was_false: true,
        raw_data: rawData,
      },
    };
  }

  // Validasi durasi maksimal (3 jam = 10800000ms)
  const MAX_DURATION_MS = 3 * 60 * 60 * 1000; // 3 jam
  const invalidDur = dur <= 0 || dur > MAX_DURATION_MS;
  const invalidTl = tl <= 0 || tl > dur;

  // RUNNING: tl > 0 && dur > 0 && valid
  const running = tl > 0 && dur > 0 && !invalidDur && !invalidTl;

  if (running) {
    return {
      status: "RUNNING",
      reason: "tl > 0 && dur > 0 && valid",
      details: {
        tl,
        dur,
        tl_valid: true,
        dur_valid: true,
        raw_data: rawData,
      },
    };
  }

  // READY: online tapi tidak running
  return {
    status: "READY",
    reason: "ol=true but not running",
    details: {
      ol: true,
      invalid_tl: tl <= 0,
      invalid_dur: dur <= 0 || dur > MAX_DURATION_MS,
      tl_exceeded_dur: tl > dur,
      dur_exceeded_max: dur > MAX_DURATION_MS,
      raw_data: rawData,
    },
  };
}

/** RULE STATUS (baru, ketat) - backward compatibility */
function classifyNew(device: any, updated_at: string | null): Out["status"] {
  return classifyNewWithReason(device, updated_at).status;
}

/**
 * Log status change ke gateway API (non-blocking)
 */
async function logStatusChangeIfNeeded(
  machineId: string,
  machineLabel: string,
  oldStatus: Out["status"],
  newStatus: Out["status"],
  classification: { reason: string; details: any },
  device: any,
  updated_at: string | null,
  prevState?: { status: string; device: any; timestamp: number }
): Promise<void> {
  // Skip jika tidak ada perubahan
  if (oldStatus === newStatus) return;

  // Get gateway URL from config
  // Use dynamic import to avoid circular dependency
  let gatewayBase = "http://localhost:54990";
  try {
    if (typeof process !== "undefined" && process.env.EVENT_GATEWAY_BASE) {
      gatewayBase = process.env.EVENT_GATEWAY_BASE;
    } else {
      // Try to get from config module
      const { config } = await import("./config.js");
      gatewayBase = config.eventGateway.base;
    }
  } catch (error) {
    // Fallback to default
    console.warn(
      "[Normalize] Could not load gateway config, using default:",
      gatewayBase
    );
  }

  const logData = {
    machine_id: machineId,
    machine_label: machineLabel,
    timestamp: Date.now(),
    old_status: oldStatus,
    new_status: newStatus,
    raw_device_data: {
      ol: device?.ol ?? null,
      tl: device?.tl ?? null,
      dur: device?.dur ?? null,
      st: device?.st ?? null,
      aid: device?.aid ?? null,
      door: device?.door ?? null,
      sw: device?.sw ?? null,
      pow: device?.pow ?? null,
    },
    classification: {
      reason: classification.reason,
      details: classification.details,
    },
    previous_state: prevState
      ? {
          status: prevState.status,
          ol: prevState.device?.ol ?? null,
          tl: prevState.device?.tl ?? null,
          dur: prevState.device?.dur ?? null,
          timestamp: prevState.timestamp,
        }
      : undefined,
    source: "normalize" as const,
    updated_at: updated_at,
    severity: "info" as const, // Will be determined by gateway service
    should_alert: false,
  };

  // Call gateway API (non-blocking, fire and forget)
  fetch(`${gatewayBase}/api/monitoring/status-change`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(logData),
  }).catch((error) => {
    // Silently fail - logging should not block normalization
    console.error(
      `[Normalize] Failed to log status change for ${machineId}:`,
      error.message
    );
  });
}

function applyHysteresis(
  key: string,
  next: Out["status"],
  classification?: { reason: string; details: any },
  device?: any,
  updated_at?: string | null,
  machineLabel?: string
) {
  const now = Date.now();
  const rec = lastStatus.get(key);
  const prevState = previousDeviceStates.get(key);

  if (!rec) {
    lastStatus.set(key, { status: next, ts: now });
    // Store device state
    if (device) {
      previousDeviceStates.set(key, {
        status: next,
        device: { ...device },
        timestamp: now,
      });
    }
    return next;
  }

  // Hysteresis khusus untuk transisi RUNNING -> READY
  // Jika mesin berubah dari RUNNING ke READY, langsung update (tidak ada delay)
  if (rec.status === "RUNNING" && next === "READY") {
    lastStatus.set(key, { status: next, ts: now });
    // Log status change
    if (classification && device && machineLabel) {
      logStatusChangeIfNeeded(
        key,
        machineLabel,
        rec.status,
        next,
        classification,
        device,
        updated_at || null,
        prevState
      );
    }
    // Update device state
    if (device) {
      previousDeviceStates.set(key, {
        status: next,
        device: { ...device },
        timestamp: now,
      });
    }
    return next;
  }

  // Hysteresis normal untuk transisi lain (3 detik)
  if (rec.status !== next && now - rec.ts < HYST_MS) return rec.status;

  // Status berubah setelah hysteresis
  // Log status change
  if (classification && device && machineLabel) {
    logStatusChangeIfNeeded(
      key,
      machineLabel,
      rec.status,
      next,
      classification,
      device,
      updated_at || null,
      prevState
    );
  }

  lastStatus.set(key, { status: next, ts: now });
  // Update device state
  if (device) {
    previousDeviceStates.set(key, {
      status: next,
      device: { ...device },
      timestamp: now,
    });
  }
  return next;
}

/** SLOT MAP (pakem, zero-padded) */
const SLOT_BY_LABEL: Record<string, string> = {
  // TOP row (Dryer)
  D12: "div12",
  D11: "div11",
  D10: "div10",
  D09: "div9",
  D08: "div8",
  D07: "div7",
  D06: "div6",
  D05: "div5",
  D04: "div4",
  D03: "div3",
  D02: "div2",
  D01: "div1",
  // BOTTOM row (Washer)
  W01: "div14",
  W02: "div15",
  W03: "div16",
  W04: "div17",
  W05: "div18",
  W06: "div19",
  W07: "div20",
  W08: "div21",
  W09: "div22",
  W10: "div23",
  W10_OLD: "div26",
  W11: "div24",
  W12: "div25",
};

function pickSlot(label: string): string {
  return SLOT_BY_LABEL[label] || "div0";
}

export function normalize(rows: Up[], ctrlMap: Record<string, string> | null) {
  const dryers = rows.filter((x) => x.jenis === 2);
  const washers = rows.filter((x) => x.jenis === 1);

  let idxD = 0,
    idxW = 0;

  const mapOne = (x: any) => {
    const ctrlId = String(
      x?.snap_report_device?.id || x?.snap_report_device?.aid || x?.id || ""
    );
    const jenis = Number(x?.jenis || 0);
    const type: "washer" | "dryer" = jenis === 2 ? "dryer" : "washer";
    const name = String(x?.nama || "");
    const device = x?.snap_report_device || {};

    if (type === "dryer") idxD += 1;
    else idxW += 1;

    const label = resolveLabel(ctrlId, name, jenis, idxD, idxW, ctrlMap); // -> W07/D10 (zero-padded)
    const slot = pickSlot(label);

    const classification = classifyNewWithReason(
      device,
      x?.updated_at || null,
      ctrlId
    );
    const rawStatus = classification.status;
    const status = applyHysteresis(
      ctrlId,
      rawStatus,
      classification,
      device,
      x?.updated_at || null,
      label
    );

    // Calculate elapsed time for running machines (stopwatch)
    const elapsedData = calculateElapsed(
      ctrlId,
      status,
      x?.updated_at || null,
      device
    );

    return {
      id: ctrlId,
      type,
      label,
      slot,
      status,
      updated_at: x?.updated_at || null,
      aid: device?.aid || "UNKNOWN",
      ...elapsedData,
    };
  };

  const list = [
    ...dryers.map(mapOne).sort((a, b) => a.label.localeCompare(b.label, "id")),
    ...washers.map(mapOne).sort((a, b) => a.label.localeCompare(b.label, "id")),
  ];

  const sumType = (t: "dryer" | "washer") => {
    const arr = list.filter((x) => x.type === t);
    const total = arr.length,
      ready = arr.filter((x) => x.status === "READY").length,
      running = arr.filter((x) => x.status === "RUNNING").length,
      offline = arr.filter((x) => x.status === "OFFLINE").length;
    return { total, ready, running, offline };
  };

  return {
    list,
    summary: { dryer: sumType("dryer"), washer: sumType("washer") },
  };
}
