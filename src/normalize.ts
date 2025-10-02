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
};

const HYST_MS = Number(process.env.HYST_MS || 3000);
const lastStatus: Map<string, { status: Out["status"]; ts: number }> =
  new Map();

// Store start times for running machines
const startTimes: Map<string, number> = new Map();

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

  // Get or set start time (use updated_at as start time)
  let startTime = startTimes.get(ctrlId);
  if (!startTime) {
    startTime = updatedAtMs;
    startTimes.set(ctrlId, startTime);
  }

  return {
    elapsed_ms: Math.round(maxElapsed),
    start_time: startTime,
  };
}

/** Normalisasi label ke zero-padded */
function normalizeLabel(raw: string): string {
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

/** RULE STATUS (baru, ketat) */
function classifyNew(device: any, updated_at: string | null): Out["status"] {
  const ol = !!device?.ol;
  const tl = Number(device?.tl ?? 0); // ms
  const dur = Number(device?.dur ?? 0); // ms
  // const door = !!device?.door;
  // const sw = !!device?.sw;
  const st = !!device?.st;

  if (!ol) return "OFFLINE";

  // Validasi durasi maksimal (3 jam = 10800000ms)
  const MAX_DURATION_MS = 3 * 60 * 60 * 1000; // 3 jam

  // Validasi data tidak terlalu lama (max 2 jam sejak updated_at)
  const MAX_DATA_AGE_MS = 2 * 60 * 60 * 1000; // 2 jam
  if (updated_at) {
    const dataAge = Date.now() - new Date(updated_at).getTime();
    if (dataAge > MAX_DATA_AGE_MS) {
      console.log(`Data too old: ${dataAge}ms, marking as READY`);
      return "READY";
    }
  }

  // Mesin running jika:
  // 1. tl > 0 (waktu tersisa > 0)
  // 2. dur > 0 (durasi total > 0)
  // 3. dur <= MAX_DURATION_MS (durasi masuk akal)
  // 4. tl <= dur (waktu tersisa tidak lebih dari durasi total)
  const running = tl > 0 && dur > 0 && dur <= MAX_DURATION_MS && tl <= dur;

  return running ? "RUNNING" : "READY";
}

function applyHysteresis(key: string, next: Out["status"]) {
  const now = Date.now();
  const rec = lastStatus.get(key);
  if (!rec) {
    lastStatus.set(key, { status: next, ts: now });
    return next;
  }

  // Hysteresis khusus untuk transisi RUNNING -> READY
  // Jika mesin berubah dari RUNNING ke READY, langsung update (tidak ada delay)
  if (rec.status === "RUNNING" && next === "READY") {
    lastStatus.set(key, { status: next, ts: now });
    return next;
  }

  // Hysteresis normal untuk transisi lain (3 detik)
  if (rec.status !== next && now - rec.ts < HYST_MS) return rec.status;
  lastStatus.set(key, { status: next, ts: now });
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

    const rawStatus = classifyNew(device, x?.updated_at || null);
    const status = applyHysteresis(ctrlId, rawStatus);

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
