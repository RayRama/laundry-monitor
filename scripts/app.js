/**
 * Laundry Monitor - TV Display Application
 * Render functions, polling, dan hysteresis untuk monitoring mesin laundry
 */

// Konstanta
const STATUS = {
  READY: "READY",
  RUNNING: "RUNNING",
  OFFLINE: "OFFLINE",
};

const MACHINE_TYPE = {
  DRYER: "D",
  WASHER: "W",
};

// FE kini pakai slot dari API langsung

// Global variables
let machines = [];
let lastUpdateTime = null;
let isDataStale = false;
let meta = { ts: null, stale: true };
let lastETag = null;

// Tentukan base URL API:
// - Jika dibuka via file:// → gunakan http://localhost:3000
// - Jika bukan di port 3000 (mis. serve statis di port lain) → gunakan http://localhost:3000
// - Jika memang di 3000 (diserve oleh BE) → gunakan relative path ""
const onFile = window.location.origin.startsWith("file");
const onPort3000 = window.location.port === "3000";
const API_BASE = onFile
  ? "http://localhost:3000"
  : onPort3000
  ? ""
  : "http://localhost:3000";

// Hysteresis untuk mencegah "kedip" status
const hysteresisCache = new Map();
const HYSTERESIS_THRESHOLD = 3000; // 3 detik

/**
 * Inisialisasi aplikasi
 */
async function init() {
  console.log("Initializing Laundry Monitor...");

  // Render awal kosong sambil fetch pertama
  renderGrid();
  renderEta();
  renderSummary();
  renderUpdatedAt();

  // Fetch pertama langsung agar tidak menunggu jitter
  try {
    await fetchFromBackend();
  } catch (e) {
    console.error("Initial fetch failed", e);
  }

  // Mulai polling dari API
  startPolling();

  console.log("Application initialized successfully");
}

/**
 * Render grid mesin
 */
function renderGrid() {
  const grid = document.getElementById("machineGrid");
  if (!grid) return;

  // Clear existing content
  grid.innerHTML = "";

  machines.forEach((machine) => {
    const divClass = machine.slot; // gunakan slot dari API
    if (!divClass) {
      console.warn(`No grid mapping found for machine ${machine.label}`);
      return;
    }

    const machineElement = document.createElement("div");
    machineElement.className = `machine ${divClass}`;
    machineElement.textContent = machine.label;
    machineElement.dataset.machineId = machine.id;

    // Apply status class dengan hysteresis
    applyStatusWithHysteresis(machineElement, machine);

    grid.appendChild(machineElement);
  });
}

/**
 * Apply status dengan hysteresis untuk mencegah "kedip"
 */
function applyStatusWithHysteresis(element, machine) {
  const machineId = machine.id;
  const currentStatus = machine.status;
  const now = Date.now();

  // Check hysteresis cache
  const cached = hysteresisCache.get(machineId);

  if (cached && now - cached.timestamp < HYSTERESIS_THRESHOLD) {
    // Gunakan status cached jika masih dalam threshold
    element.className = `machine ${machine.slot} ${getStatusClass(
      cached.status
    )}`;
    return;
  }

  // Update cache dan apply status baru
  hysteresisCache.set(machineId, {
    status: currentStatus,
    timestamp: now,
  });

  // Remove old status classes
  element.classList.remove("is-ready", "is-using", "is-offline");
  // Add new status class
  element.classList.add(getStatusClass(currentStatus));
}

/**
 * Get CSS class untuk status
 */
function getStatusClass(status) {
  switch (status) {
    case STATUS.READY:
      return "is-ready";
    case STATUS.USING:
      return "is-using";
    case STATUS.OFFLINE:
      return "is-offline";
    default:
      return "is-offline";
  }
}

/**
 * Convert HH:MM to minutes for sorting
 */
function toMinutes(hhmm) {
  if (!hhmm || hhmm === "—") return Infinity;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Format ETA with Indonesian time format (HH.MM)
 */
function formatETAIndonesia(eta) {
  if (!eta || eta === "—") return "—";
  return eta.replace(":", ".");
}

/**
 * Render panel ETA
 */
function renderEta() {
  const dryerList = document.getElementById("dryerEtaList");
  const washerList = document.getElementById("washerEtaList");

  if (!dryerList || !washerList) return;

  // Get USING machines by type and sort by ETA
  const usingDryers = machines
    .filter((m) => m.type === MACHINE_TYPE.DRYER && m.status === STATUS.USING)
    .sort((a, b) => toMinutes(a.eta) - toMinutes(b.eta))
    .slice(0, 6); // Max 6 items

  const usingWashers = machines
    .filter((m) => m.type === MACHINE_TYPE.WASHER && m.status === STATUS.USING)
    .sort((a, b) => toMinutes(a.eta) - toMinutes(b.eta))
    .slice(0, 6); // Max 6 items

  // Render dryer ETA
  dryerList.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const item = document.createElement("div");
    item.className = "eta-item";

    if (i < usingDryers.length) {
      const machine = usingDryers[i];
      const formattedETA = formatETAIndonesia(machine.eta);
      item.textContent = `${machine.label} ⇒ ${formattedETA}`;
    } else {
      item.textContent = "—";
      item.classList.add("placeholder");
    }

    dryerList.appendChild(item);
  }

  // Render washer ETA
  washerList.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const item = document.createElement("div");
    item.className = "eta-item";

    if (i < usingWashers.length) {
      const machine = usingWashers[i];
      const formattedETA = formatETAIndonesia(machine.eta);
      item.textContent = `${machine.label} ⇒ ${formattedETA}`;
    } else {
      item.textContent = "—";
      item.classList.add("placeholder");
    }

    washerList.appendChild(item);
  }
}

/**
 * Render summary statistics
 */
function renderSummary() {
  const dryerReadyEl = document.getElementById("dryerReadyPercent");
  const dryerUsingEl = document.getElementById("dryerUsingPercent");
  const washerReadyEl = document.getElementById("washerReadyPercent");
  const washerUsingEl = document.getElementById("washerUsingPercent");

  if (!dryerReadyEl || !dryerUsingEl || !washerReadyEl || !washerUsingEl)
    return;

  // Calculate statistics for Dryer
  const dryers = machines.filter((m) => m.type === MACHINE_TYPE.DRYER);
  const dryerReady = dryers.filter((m) => m.status === STATUS.READY).length;
  const dryerUsing = dryers.filter((m) => m.status === STATUS.USING).length;
  // const dryerReadyPercent =
  //   Math.round(((dryerReady / dryers.length) * 100) / 10) * 10; // Round to nearest 10
  // const dryerUsingPercent =
  //   Math.round(((dryerUsing / dryers.length) * 100) / 10) * 10;

  // Calculate statistics for Washer
  const washers = machines.filter((m) => m.type === MACHINE_TYPE.WASHER);
  const washerReady = washers.filter((m) => m.status === STATUS.READY).length;
  const washerUsing = washers.filter((m) => m.status === STATUS.USING).length;
  // const washerReadyPercent =
  //   Math.round(((washerReady / washers.length) * 100) / 10) * 10;
  // const washerUsingPercent =
  //   Math.round(((washerUsing / washers.length) * 100) / 10) * 10;

  // Update DOM
  dryerReadyEl.textContent = `${dryerReady} Mesin`;
  dryerUsingEl.textContent = `${dryerUsing} Mesin`;
  washerReadyEl.textContent = `${washerReady} Mesin`;
  washerUsingEl.textContent = `${washerUsing} Mesin`;
}

/**
 * Render timestamp terakhir update
 */
function renderUpdatedAt() {
  const lastUpdatedEl = document.getElementById("last-updated");
  if (!lastUpdatedEl) return;

  // Pastikan jam yang ditampilkan sesuai dengan waktu lokal Asia/Jakarta,
  // walaupun meta.ts sudah dalam bentuk ISO string UTC+7 dari server.
  // Jika meta.ts ada, parse dan tampilkan sesuai zona Asia/Jakarta.
  const ts = meta.ts ? new Date(meta.ts) : new Date();
  const jam = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(ts);

  // Check if data is stale
  const now = new Date();
  const minutesSinceUpdate = meta.ts
    ? Math.floor((now - ts) / 60000)
    : lastUpdateTime
    ? Math.floor((now - lastUpdateTime) / 60000)
    : 0;

  // Remove existing status classes
  lastUpdatedEl.classList.remove("warn", "danger", "is-stale");

  if (isDataStale || minutesSinceUpdate > 10) {
    lastUpdatedEl.classList.add("danger", "is-stale");
  } else if (minutesSinceUpdate > 5) {
    lastUpdatedEl.classList.add("warn");
  }

  lastUpdatedEl.textContent = `Terakhir diperbarui • ${jam}`;
}

// Constants for refresh scheduling - synchronized with backend
const REFRESH_INTERVAL_MS = 180000; // 3 menit
const REFRESH_OFFSET_MS = 10000; // 10 detik offset

/**
 * Schedule next refresh with 3-minute + 10-second offset
 */
function scheduleNextRefresh(fn) {
  const delay = REFRESH_INTERVAL_MS + REFRESH_OFFSET_MS;
  setTimeout(async () => {
    await fn();
    scheduleNextRefresh(fn);
  }, delay);
}

/**
 * Start polling untuk update data dengan jitter
 */
async function fetchFromBackend() {
  try {
    const headers = { "cache-control": "no-cache" };
    if (lastETag) {
      headers["If-None-Match"] = lastETag;
    }

    const res = await fetch(`${API_BASE}/api/machines`, {
      cache: "no-store",
      headers,
    });
    console.log("fetchFromBackend", res);

    // Handle 304 Not Modified response
    if (res.status === 304) {
      console.log("Data unchanged (304), updating stale status only");

      // Read headers for stale status
      const dataStale = res.headers.get("X-Data-Stale") === "true";
      const lastSuccess = res.headers.get("X-Last-Success");

      // Update meta and stale status without changing machines
      meta.stale = dataStale;
      isDataStale = dataStale;

      if (lastSuccess) {
        meta.ts = lastSuccess;
      }

      // Update UI for stale status only
      renderUpdatedAt();
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const items = Array.isArray(data?.machines) ? data.machines : [];
    meta = data?.meta || { ts: null, stale: true };

    // Map status RUNNING->USING, type dryer/washer->D/W
    machines = items.map((m) => ({
      id: m.id,
      type: m.type === "dryer" ? "D" : "W",
      label: m.label,
      slot: m.slot,
      status: m.status === "RUNNING" ? "USING" : m.status,
      eta: null,
      updated_at: m.updated_at,
    }));

    // Update lastETag from response
    const newETag = res.headers.get("ETag");
    if (newETag) {
      lastETag = newETag;
    }

    lastUpdateTime = new Date();
    isDataStale = !!meta.stale;

    renderGrid();
    renderEta();
    renderSummary();
    renderUpdatedAt();
  } catch (err) {
    console.error("Fetch backend gagal:", err);
    // Jangan update machines agar tetap tampil snapshot lama
    isDataStale = true;
    renderUpdatedAt();
  }
}

function startPolling() {
  console.log("Starting refresh scheduling with 3-5 minute jitter");

  // Schedule first refresh
  scheduleNextRefresh(async () => {
    await fetchFromBackend();
    renderEta();
    renderSummary();
    renderUpdatedAt();
  });
}

// Event listeners
document.addEventListener("DOMContentLoaded", init);

// Refetch when tab becomes active
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    console.log("Tab became active, refetching data");
    fetchFromBackend();
  }
});

// Error handling
window.addEventListener("error", (event) => {
  console.error("Application error:", event.error);
});

// Export untuk testing (jika diperlukan)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATUS,
    MACHINE_TYPE,
    SLOT_TO_MACHINE,
    init,
    renderGrid,
    renderEta,
    renderSummary,
    renderUpdatedAt,
    toMinutes,
    formatETAIndonesia,
  };
}
