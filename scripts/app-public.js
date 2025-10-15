/**
 * Laundry Monitor - Public TV Display Application
 * Simplified version for consumers - no machine names or usage statistics
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

// Global variables
let machines = [];
let lastUpdateTime = null;
let isDataStale = false;
let meta = { ts: null, stale: true };

let lastETag = null;

// Tentukan base URL API:
// - Jika dibuka via file:// → gunakan http://localhost:3000
// - Jika bukan di port 3000 (mis. serve statis di port lain) → gunakan http://localhost:3000
// - Jika di Vercel deployment → gunakan relative path
// - Jika di localhost:3000 (diserve oleh BE) → gunakan relative path ""
// - Jika di file:// → gunakan localhost:3000
const onFile = window.location.origin.startsWith("file");
const onPort3000 = window.location.port === "3000";
const onVercel = window.location.hostname.includes("vercel.app");
const API_BASE = onFile
  ? "http://localhost:3000"
  : onPort3000 || onVercel
  ? ""
  : "http://localhost:3000";

// Hysteresis untuk mencegah "kedip" status
const hysteresisCache = new Map();
const HYSTERESIS_THRESHOLD = 3000; // 3 detik

/**
 * Inisialisasi aplikasi
 */
async function init() {
  console.log("Initializing Public Laundry Monitor...");

  // Render awal kosong sambil fetch pertama
  renderGrid();
  renderEta();
  renderStatusLegend();
  renderUpdatedAt();

  // Fetch pertama langsung agar tidak menunggu jitter
  try {
    await fetchFromBackend();
  } catch (e) {
    console.error("Initial fetch failed", e);
  }

  // Mulai polling dari API
  startPolling();

  console.log("Public application initialized successfully");
}

/**
 * Render grid mesin dengan responsive layout (tanpa nama brand)
 */
function renderGrid() {
  const screenWidth = window.innerWidth;
  const isMobile = screenWidth <= 767;
  const isTablet = screenWidth > 767 && screenWidth <= 1023;
  const isDesktop = screenWidth > 1023 && screenWidth <= 1919;
  const isTV = screenWidth > 1919;

  if (isMobile) {
    // Mobile: Render separate grids for dryers and washers
    renderMobileGrids();
  } else {
    // Desktop/Tablet/TV: Render single grid
    renderSingleGrid();
  }
}

/**
 * Render single grid for desktop/tablet/TV (tanpa nama brand)
 */
function renderSingleGrid() {
  const grid = document.getElementById("machineGrid");
  if (!grid) return;

  // Hide mobile grids
  const mobileGrids = document.getElementById("mobileGrids");
  if (mobileGrids) mobileGrids.style.display = "none";

  // Show single grid
  grid.style.display = "grid";

  // Clear existing content
  grid.innerHTML = "";

  // Determine screen size for responsive ordering
  const screenWidth = window.innerWidth;
  const isTablet = screenWidth > 767 && screenWidth <= 1023;
  const isDesktop = screenWidth > 1023 && screenWidth <= 1919;

  // Sort machines based on screen size
  let sortedMachines = [...machines];

  if (isTablet) {
    // Tablet: Sort by type and label (washer first)
    sortedMachines.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "W" ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  } else if (isDesktop) {
    // Desktop: Sort by type and label (washer first)
    sortedMachines.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "W" ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  }
  // TV: Keep original order (no sorting)

  sortedMachines.forEach((machine, index) => {
    let divClass = machine.slot; // Default slot from API

    // Override slot for responsive layouts
    if (isTablet || isDesktop) {
      // Use index-based positioning for responsive layouts
      divClass = `responsive-${index}`;
    }

    // Create machine box (tanpa wrapper untuk brand)
    const machineElement = document.createElement("div");
    machineElement.className = `machine ${divClass}`;
    machineElement.dataset.machineId = machine.id;

    // Create machine content
    const machineContent = document.createElement("div");
    machineContent.className = "machine-content";

    // Machine label (W12, D01, etc.)
    const labelElement = document.createElement("div");
    labelElement.className = "machine-label";
    labelElement.textContent = machine.label;
    machineContent.appendChild(labelElement);

    // Status info (different for RUNNING vs READY/OFFLINE)
    const statusInfo = document.createElement("div");
    statusInfo.className = "machine-status-info";

    if (machine.status === "RUNNING") {
      // For RUNNING: Show elapsed time only
      const timeElement = document.createElement("div");
      timeElement.className = "machine-time";
      timeElement.textContent = getStatusText(machine);
      statusInfo.appendChild(timeElement);
    }

    machineContent.appendChild(statusInfo);
    machineElement.appendChild(machineContent);

    // Apply status class dengan hysteresis
    applyStatusWithHysteresis(machineElement, machine);

    grid.appendChild(machineElement);
  });
}

/**
 * Render separate grids for mobile (dryers and washers) - tanpa nama brand
 */
function renderMobileGrids() {
  const dryerGrid = document.getElementById("dryerGrid");
  const washerGrid = document.getElementById("washerGrid");
  const mobileGrids = document.getElementById("mobileGrids");
  const singleGrid = document.getElementById("machineGrid");

  if (!dryerGrid || !washerGrid || !mobileGrids) return;

  // Hide single grid
  if (singleGrid) singleGrid.style.display = "none";

  // Show mobile grids
  mobileGrids.style.display = "block";

  // Clear existing content
  dryerGrid.innerHTML = "";
  washerGrid.innerHTML = "";

  // Separate machines by type
  const washers = machines.filter((m) => m.type === "W");
  const dryers = machines.filter((m) => m.type === "D");

  // Sort each type by label
  washers.sort((a, b) => a.label.localeCompare(b.label));
  dryers.sort((a, b) => a.label.localeCompare(b.label));

  // Render washers first (tanpa brand)
  washers.forEach((machine, index) => {
    const machineElement = document.createElement("div");
    machineElement.className = `machine responsive-${index}`;
    machineElement.dataset.machineId = machine.id;

    const machineContent = document.createElement("div");
    machineContent.className = "machine-content";

    const labelElement = document.createElement("div");
    labelElement.className = "machine-label";
    labelElement.textContent = machine.label;
    machineContent.appendChild(labelElement);

    const statusInfo = document.createElement("div");
    statusInfo.className = "machine-status-info";

    if (machine.status === "RUNNING") {
      const timeElement = document.createElement("div");
      timeElement.className = "machine-time";
      timeElement.textContent = getStatusText(machine);
      statusInfo.appendChild(timeElement);
    }

    machineContent.appendChild(statusInfo);
    machineElement.appendChild(machineContent);

    applyStatusWithHysteresis(machineElement, machine);

    washerGrid.appendChild(machineElement);
  });

  // Render dryers (tanpa brand)
  dryers.forEach((machine, index) => {
    const machineElement = document.createElement("div");
    machineElement.className = `machine responsive-${index}`;
    machineElement.dataset.machineId = machine.id;

    const machineContent = document.createElement("div");
    machineContent.className = "machine-content";

    const labelElement = document.createElement("div");
    labelElement.className = "machine-label";
    labelElement.textContent = machine.label;
    machineContent.appendChild(labelElement);

    const statusInfo = document.createElement("div");
    statusInfo.className = "machine-status-info";

    if (machine.status === "RUNNING") {
      const timeElement = document.createElement("div");
      timeElement.className = "machine-time";
      timeElement.textContent = getStatusText(machine);
      statusInfo.appendChild(timeElement);
    }

    machineContent.appendChild(statusInfo);
    machineElement.appendChild(machineContent);

    applyStatusWithHysteresis(machineElement, machine);

    dryerGrid.appendChild(machineElement);
  });
}

/**
 * Get status text for machine
 */
function getStatusText(machine) {
  switch (machine.status) {
    case STATUS.RUNNING:
      const elapsed = machine.elapsed_ms
        ? formatElapsedTime(machine.elapsed_ms)
        : "0m";
      return `${elapsed} ⏱️`;
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
 * Convert elapsed milliseconds to minutes for sorting
 */
function toMinutes(elapsedMs) {
  if (!elapsedMs || elapsedMs === "—") return Infinity;
  if (typeof elapsedMs === "string") {
    // Legacy format HH:MM
    const [h, m] = elapsedMs.split(":").map(Number);
    return h * 60 + m;
  }
  // New format: milliseconds
  return Math.floor(elapsedMs / (1000 * 60));
}

/**
 * Format elapsed time as minimal text
 */
function formatElapsedTime(elapsedMs) {
  if (!elapsedMs || elapsedMs === "—") return "—";

  // Handle new format: milliseconds
  if (typeof elapsedMs === "number") {
    const totalMinutes = Math.floor(elapsedMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  // Handle legacy format: HH:MM string
  if (typeof elapsedMs === "string") {
    return elapsedMs.replace(":", ".");
  }

  return "—";
}

/**
 * Render panel ETA (simplified - no usage statistics)
 */
function renderEta() {
  const etaBody = document.getElementById("etaBody");
  if (!etaBody) return;

  // Get all running machines and sort by elapsed time (longest first)
  const runningMachines = machines
    .filter((m) => m.status === STATUS.RUNNING)
    .sort((a, b) => toMinutes(b.elapsed_ms) - toMinutes(a.elapsed_ms));

  etaBody.innerHTML = "";

  if (runningMachines.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "eta-placeholder";
    placeholder.textContent = "Belum ada mesin berjalan";
    etaBody.appendChild(placeholder);
    return;
  }

  runningMachines.forEach((machine, index) => {
    const row = document.createElement("div");
    row.className = `eta-row ${index === 0 ? "eta-priority" : ""}`;

    const machineCell = document.createElement("div");
    machineCell.className = "eta-machine";
    machineCell.innerHTML = `
      <span class="eta-label">${machine.label}</span>
    `;

    const timeCell = document.createElement("div");
    timeCell.className = "eta-time";
    const formattedElapsed = formatElapsedTime(machine.elapsed_ms);
    timeCell.innerHTML = `
      <span class="eta-duration">${formattedElapsed}</span>
      <span class="eta-subtitle">sudah berjalan</span>
    `;

    row.appendChild(machineCell);
    row.appendChild(timeCell);
    etaBody.appendChild(row);
  });
}

/**
 * Render status legend with separate counts for washer and dryer
 */
function renderStatusLegend() {
  // Calculate washer counts
  const washers = machines.filter((m) => m.type === "W");
  const washerReady = washers.filter((m) => m.status === STATUS.READY).length;
  const washerRunning = washers.filter(
    (m) => m.status === STATUS.RUNNING
  ).length;
  const washerOffline = washers.filter(
    (m) => m.status === STATUS.OFFLINE
  ).length;

  // Calculate dryer counts
  const dryers = machines.filter((m) => m.type === "D");
  const dryerReady = dryers.filter((m) => m.status === STATUS.READY).length;
  const dryerRunning = dryers.filter((m) => m.status === STATUS.RUNNING).length;
  const dryerOffline = dryers.filter((m) => m.status === STATUS.OFFLINE).length;

  // Update washer counts
  const washerReadyEl = document.getElementById("washer-ready-count");
  const washerRunningEl = document.getElementById("washer-running-count");
  const washerOfflineEl = document.getElementById("washer-offline-count");

  if (washerReadyEl) washerReadyEl.textContent = washerReady;
  if (washerRunningEl) washerRunningEl.textContent = washerRunning;
  if (washerOfflineEl) washerOfflineEl.textContent = washerOffline;

  // Update dryer counts
  const dryerReadyEl = document.getElementById("dryer-ready-count");
  const dryerRunningEl = document.getElementById("dryer-running-count");
  const dryerOfflineEl = document.getElementById("dryer-offline-count");

  if (dryerReadyEl) dryerReadyEl.textContent = dryerReady;
  if (dryerRunningEl) dryerRunningEl.textContent = dryerRunning;
  if (dryerOfflineEl) dryerOfflineEl.textContent = dryerOffline;
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
    second: "2-digit",
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

// Constants for refresh scheduling - random between 30-60 seconds
const MIN_REFRESH_INTERVAL_MS = 30000; // 30 detik
const MAX_REFRESH_INTERVAL_MS = 60000; // 60 detik

/**
 * Get random refresh interval between 30-60 seconds
 */
function getRandomRefreshInterval() {
  return (
    Math.floor(
      Math.random() * (MAX_REFRESH_INTERVAL_MS - MIN_REFRESH_INTERVAL_MS + 1)
    ) + MIN_REFRESH_INTERVAL_MS
  );
}

/**
 * Schedule next refresh with random 30-60 second interval
 */
function scheduleNextRefresh(fn) {
  const delay = getRandomRefreshInterval();
  console.log(`Next refresh in ${Math.round(delay / 1000)} seconds`);
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
      elapsed_ms: m.elapsed_ms || null,
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
    renderStatusLegend();
    renderUpdatedAt();
  } catch (err) {
    console.error("Fetch backend gagal:", err);
    // Jangan update machines agar tetap tampil snapshot lama
    isDataStale = true;
    renderUpdatedAt();
  }
}

function startPolling() {
  console.log("Starting refresh scheduling with random 30-60 second intervals");

  // Schedule first refresh
  scheduleNextRefresh(async () => {
    await fetchFromBackend();
    renderGrid();
    renderEta();
    renderStatusLegend();
    renderUpdatedAt();
  });
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
  // Initialize the app (no machine config needed for public view)
  init();
});

// Refetch when tab becomes active
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    console.log("Tab became active, refetching data");
    fetchFromBackend();
  }
});

// Re-render grid when window is resized
window.addEventListener("resize", () => {
  console.log("Window resized, re-rendering grid");
  renderGrid();
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
    renderStatusLegend,
    renderUpdatedAt,
    toMinutes,
    formatElapsedTime,
    getStatusText,
  };
}
