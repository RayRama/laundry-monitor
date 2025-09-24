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

    // Add status text below machine
    const statusElement = document.createElement("div");
    statusElement.className = "machine-status";
    statusElement.textContent = getStatusText(machine);
    machineElement.appendChild(statusElement);

    // Apply status class dengan hysteresis
    applyStatusWithHysteresis(machineElement, machine);

    grid.appendChild(machineElement);
  });
}

/**
 * Get status text for machine
 */
function getStatusText(machine) {
  switch (machine.status) {
    case STATUS.RUNNING:
      const eta = machine.eta ? formatETAIndonesia(machine.eta) : "0m";
      return `${eta} 🔄`;
    case STATUS.READY:
      return "";
    case STATUS.OFFLINE:
      return "Offline";
    default:
      return "Offline";
  }
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
  element.classList.remove("is-ready", "is-running", "is-offline");
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
    case STATUS.RUNNING:
      return "is-running";
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
  const etaBody = document.getElementById("etaBody");
  if (!etaBody) return;

  // Get all running machines and sort by ETA
  const runningMachines = machines
    .filter((m) => m.status === STATUS.RUNNING)
    .sort((a, b) => toMinutes(a.eta) - toMinutes(b.eta))
    .slice(0, 3); // Max 3 items

  etaBody.innerHTML = "";

  if (runningMachines.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "eta-placeholder";
    placeholder.textContent = "Belum ada mesin berjalan";
    etaBody.appendChild(placeholder);
    return;
  }

  runningMachines.forEach((machine) => {
    const row = document.createElement("div");
    row.className = "eta-row";

    const machineCell = document.createElement("div");
    machineCell.textContent = machine.label;

    const timeCell = document.createElement("div");
    const formattedETA = formatETAIndonesia(machine.eta);
    timeCell.textContent = formattedETA;

    row.appendChild(machineCell);
    row.appendChild(timeCell);
    etaBody.appendChild(row);
  });
}

/**
 * Render summary statistics with donut charts
 */
function renderSummary() {
  const dryerNumberEl = document.getElementById("dryerNumber");
  const washerNumberEl = document.getElementById("washerNumber");
  const dryerDonutEl = document.getElementById("dryerDonut");
  const washerDonutEl = document.getElementById("washerDonut");

  if (!dryerNumberEl || !washerNumberEl || !dryerDonutEl || !washerDonutEl)
    return;

  // Calculate statistics for Dryer
  const dryers = machines.filter((m) => m.type === MACHINE_TYPE.DRYER);
  const dryerReady = dryers.filter((m) => m.status === STATUS.READY).length;
  const dryerRunning = dryers.filter((m) => m.status === STATUS.RUNNING).length;
  const dryerOffline = dryers.filter((m) => m.status === STATUS.OFFLINE).length;

  // Calculate statistics for Washer
  const washers = machines.filter((m) => m.type === MACHINE_TYPE.WASHER);
  const washerReady = washers.filter((m) => m.status === STATUS.READY).length;
  const washerRunning = washers.filter(
    (m) => m.status === STATUS.RUNNING
  ).length;
  const washerOffline = washers.filter(
    (m) => m.status === STATUS.OFFLINE
  ).length;

  // Update numbers
  dryerNumberEl.textContent = `${dryerReady}/${dryers.length}`;
  washerNumberEl.textContent = `${washerReady}/${washers.length}`;

  // Update donut charts
  updateDonutChart(
    dryerDonutEl,
    dryerReady,
    dryerRunning,
    dryerOffline,
    dryers.length
  );
  updateDonutChart(
    washerDonutEl,
    washerReady,
    washerRunning,
    washerOffline,
    washers.length
  );
}

/**
 * Update donut chart with conic gradient
 */
function updateDonutChart(element, ready, running, offline, total) {
  if (total === 0) {
    element.style.background = `conic-gradient(var(--line) 0deg 360deg)`;
    return;
  }

  const readyAngle = (ready / total) * 360;
  const runningAngle = (running / total) * 360;
  const offlineAngle = (offline / total) * 360;

  let gradient = "";
  let currentAngle = 0;

  if (ready > 0) {
    gradient += `var(--ready) ${currentAngle}deg ${
      currentAngle + readyAngle
    }deg`;
    currentAngle += readyAngle;
  }

  if (running > 0) {
    if (gradient) gradient += ", ";
    gradient += `var(--running) ${currentAngle}deg ${
      currentAngle + runningAngle
    }deg`;
    currentAngle += runningAngle;
  }

  if (offline > 0) {
    if (gradient) gradient += ", ";
    gradient += `var(--offline) ${currentAngle}deg ${
      currentAngle + offlineAngle
    }deg`;
    currentAngle += offlineAngle;
  }

  // Fill remaining with line color
  if (currentAngle < 360) {
    if (gradient) gradient += ", ";
    gradient += `var(--line) ${currentAngle}deg 360deg`;
  }

  element.style.background = `conic-gradient(${gradient})`;
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

    // Map status dan type
    machines = items.map((m) => ({
      id: m.id,
      type: m.type === "dryer" ? "D" : "W",
      label: m.label,
      slot: m.slot,
      status: m.status, // Keep original status (READY, RUNNING, OFFLINE)
      eta: m.eta || null,
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
    init,
    renderGrid,
    renderEta,
    renderSummary,
    renderUpdatedAt,
    toMinutes,
    formatETAIndonesia,
    getStatusText,
    updateDonutChart,
  };
}
