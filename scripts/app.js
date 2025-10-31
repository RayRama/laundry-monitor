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

// Machine brand mapping
// Machine Configuration - will be loaded from external file
let MACHINE_CONFIG = null;
let machineBrands = {};

// Hardcoded machine ID mapping (from controllers.json)
const MACHINE_ID_MAPPING = {
  D48AFC354603: "D05",
  D48AFC325A64: "D07",
  "2CF4321072A5": "D01",
  "68C63AFC13FA": "D02",
  "483FDA643B85": "D03",
  "48E7296DE4BF": "D04",
  D48AFC35465C: "D06",
  D48AFC31F4C0: "D08",
  D48AFC354357: "D09",
  BCDDC248DF58: "D10",
  C82B961E9BF3: "D11",
  "8CCE4EF44A99": "D12",
  "9C9C1F410120": "W01",
  "98F4ABD8506A": "W02",
  "8CAAB5D53E39": "W03",
  "84F3EB6ED32F": "W04",
  "483FDA69F7C5": "W05",
  "483FDA077794": "W06",
  "807D3A4E5A46": "W07",
  "5CCF3FDBB498": "W08",
  "483FDA6AFDC7": "W10",
  "500291EB8F36": "W09",
  A4CF12F307D1: "W11",
  "68C63AFC1863": "W12",
};

// Helper function to get machine max weight
const getMachineMaxWeight = (machineLabel) => {
  if (!MACHINE_CONFIG) return 10;
  return MACHINE_CONFIG.machineMaxWeight[machineLabel] || 10;
};

// Load machine configuration from external file
async function loadMachineConfig() {
  try {
    const response = await fetch("/src/constants.js");
    if (!response.ok) {
      throw new Error("Failed to load constants");
    }
    const text = await response.text();

    // Extract MACHINE_CONFIG from the module
    const moduleMatch = text.match(
      /export const MACHINE_CONFIG = ({[\s\S]*?});/
    );
    if (moduleMatch) {
      // Simple JSON parsing for the config object
      const configStr = moduleMatch[1]
        .replace(/(\w+):/g, '"$1":') // Add quotes to keys
        .replace(/'/g, '"'); // Replace single quotes with double quotes

      MACHINE_CONFIG = JSON.parse(configStr);
      machineBrands = MACHINE_CONFIG.machineBrands;
      console.log("✅ Machine config loaded from constants.js");
    } else {
      throw new Error("Could not parse MACHINE_CONFIG");
    }
  } catch (error) {
    console.warn("⚠️ Failed to load machine config, using fallback:", error);
    // Fallback configuration
    MACHINE_CONFIG = {
      machineBrands: {
        D01: "SQ",
        D02: "SQ",
        D03: "FGD",
        D04: "FGD",
        D05: "MDG",
        D06: "MDG",
        D07: "MDG",
        D08: "MDG",
        D09: "MDG",
        D10: "NTG",
        D11: "NTG",
        D12: "NTG",
        W01: "Titan",
        W02: "Titan",
        W03: "LG24",
        W04: "LG24",
        W05: "FGD",
        W06: "FGD",
        W07: "LG20",
        W08: "LG20",
        W09: "LG20",
        W10: "NTG",
        W11: "BEKO",
        W12: "BEKO",
      },
      machineMaxWeight: {
        D01: 10,
        D02: 10,
        D03: 10,
        D04: 10,
        D05: 10,
        D06: 10,
        D07: 10,
        D08: 10,
        D09: 10,
        D10: 10,
        D11: 10,
        D12: 10,
        W01: 10,
        W02: 10,
        W03: 10,
        W04: 10,
        W05: 10,
        W06: 10,
        W07: 10,
        W08: 10,
        W09: 10,
        W10: 10,
        W11: 10,
        W12: 10,
      },
    };
    machineBrands = MACHINE_CONFIG.machineBrands;
  }
}

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
 * Render grid mesin dengan responsive layout
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
 * Render single grid for desktop/tablet/TV
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

    // Create wrapper for machine + brand
    const machineWrapper = document.createElement("div");
    machineWrapper.className = "machine-wrapper";

    // Create machine box
    const machineElement = document.createElement("div");
    machineElement.className = `machine ${divClass}`;
    machineElement.dataset.machineId = machine.id;

    // Add click handler for READY and RUNNING machines
    if (machine.status === "READY") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", () => openMachineModal(machine));
    } else if (machine.status === "RUNNING") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", () => openStopModal(machine));
    }

    // Create machine content with new layout
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

    // Brand name - OUTSIDE the box
    const brandElement = document.createElement("div");
    brandElement.className = "machine-brand";
    brandElement.textContent = machineBrands[machine.label] || "Unknown";

    // Add machine and brand to wrapper
    machineWrapper.appendChild(machineElement);
    machineWrapper.appendChild(brandElement);

    // Apply status class dengan hysteresis
    applyStatusWithHysteresis(machineElement, machine);

    grid.appendChild(machineWrapper);
  });
}

/**
 * Render separate grids for mobile (dryers and washers)
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

  // Render washers first
  washers.forEach((machine, index) => {
    // Create wrapper for machine + brand
    const machineWrapper = document.createElement("div");
    machineWrapper.className = "machine-wrapper";

    // Create machine box
    const machineElement = document.createElement("div");
    machineElement.className = `machine responsive-${index}`;
    machineElement.dataset.machineId = machine.id;

    // Add click handler for READY and RUNNING machines
    if (machine.status === "READY") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", () => openMachineModal(machine));
    } else if (machine.status === "RUNNING") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", () => openStopModal(machine));
    }

    // Create machine content with new layout
    const machineContent = document.createElement("div");
    machineContent.className = "machine-content";

    // Machine label (D01, D02, etc.)
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

    // Brand name - OUTSIDE the box
    const brandElement = document.createElement("div");
    brandElement.className = "machine-brand";
    brandElement.textContent = machineBrands[machine.label] || "Unknown";

    // Add machine and brand to wrapper
    machineWrapper.appendChild(machineElement);
    machineWrapper.appendChild(brandElement);

    // Apply status class dengan hysteresis
    applyStatusWithHysteresis(machineElement, machine);

    washerGrid.appendChild(machineWrapper);
  });

  // Render dryers
  dryers.forEach((machine, index) => {
    // Create wrapper for machine + brand
    const machineWrapper = document.createElement("div");
    machineWrapper.className = "machine-wrapper";

    // Create machine box
    const machineElement = document.createElement("div");
    machineElement.className = `machine responsive-${index}`;
    machineElement.dataset.machineId = machine.id;

    // Add click handler for READY and RUNNING machines
    if (machine.status === "READY") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", () => openMachineModal(machine));
    } else if (machine.status === "RUNNING") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", () => openStopModal(machine));
    }

    // Create machine content with new layout
    const machineContent = document.createElement("div");
    machineContent.className = "machine-content";

    // Machine label (W01, W02, etc.)
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

    // Brand name - OUTSIDE the box
    const brandElement = document.createElement("div");
    brandElement.className = "machine-brand";
    brandElement.textContent = machineBrands[machine.label] || "Unknown";

    // Add machine and brand to wrapper
    machineWrapper.appendChild(machineElement);
    machineWrapper.appendChild(brandElement);

    // Apply status class dengan hysteresis
    applyStatusWithHysteresis(machineElement, machine);

    dryerGrid.appendChild(machineWrapper);
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
 * Render panel ETA
 */
function renderEta() {
  const etaBody = document.getElementById("etaBody");
  if (!etaBody) return;

  // Get all running machines and sort by elapsed time (longest first)
  const runningMachines = machines
    .filter((m) => m.status === STATUS.RUNNING)
    .sort((a, b) => toMinutes(b.elapsed_ms) - toMinutes(a.elapsed_ms));
  // Remove slice(0, 3) to show all items

  etaBody.innerHTML = "";

  if (runningMachines.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "eta-placeholder";
    placeholder.textContent = "Belum ada mesin berjalan";
    etaBody.appendChild(placeholder);
    return;
  }

  // Add header with note
  // const header = document.createElement("div");
  // header.className = "eta-header";
  // header.innerHTML = `
  //   <div class="eta-title">⏱️ Mesin Berjalan</div>
  //   <div class="eta-note">Teratas = hampir selesai</div>
  // `;
  // etaBody.appendChild(header);

  runningMachines.forEach((machine, index) => {
    const row = document.createElement("div");
    row.className = `eta-row ${index === 0 ? "eta-priority" : ""}`;

    const machineCell = document.createElement("div");
    machineCell.className = "eta-machine";
    machineCell.innerHTML = `
      <span class="eta-label">${machine.label}</span>
      <!-- <span class="eta-status">⏱️ Berjalan</span> -->
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
 * Render summary statistics with text-based occupation rate display
 */
function renderSummary() {
  const dryerOccupationRateEl = document.getElementById("dryerOccupationRate");
  const dryerDetailsEl = document.getElementById("dryerDetails");
  const washerOccupationRateEl = document.getElementById(
    "washerOccupationRate"
  );
  const washerDetailsEl = document.getElementById("washerDetails");

  if (
    !dryerOccupationRateEl ||
    !dryerDetailsEl ||
    !washerOccupationRateEl ||
    !washerDetailsEl
  )
    return;

  // Calculate statistics for Dryer
  const dryers = machines.filter((m) => m.type === MACHINE_TYPE.DRYER);
  const dryerReady = dryers.filter((m) => m.status === STATUS.READY).length;
  const dryerRunning = dryers.filter((m) => m.status === STATUS.RUNNING).length;
  const dryerOffline = dryers.filter((m) => m.status === STATUS.OFFLINE).length;
  const dryerTotal = dryers.length;

  // Calculate statistics for Washer
  const washers = machines.filter((m) => m.type === MACHINE_TYPE.WASHER);
  const washerReady = washers.filter((m) => m.status === STATUS.READY).length;
  const washerRunning = washers.filter(
    (m) => m.status === STATUS.RUNNING
  ).length;
  const washerOffline = washers.filter(
    (m) => m.status === STATUS.OFFLINE
  ).length;
  const washerTotal = washers.length;

  // Calculate occupation rates (percentage of machines in use)
  // Only RUNNING machines are considered "in use" - OFFLINE machines are not occupied
  const dryerInUse = dryerRunning; // Only running machines are occupied
  const dryerOccupationRate =
    dryerTotal > 0 ? Math.round((dryerInUse / dryerTotal) * 100) : 0;

  const washerInUse = washerRunning; // Only running machines are occupied
  const washerOccupationRate =
    washerTotal > 0 ? Math.round((washerInUse / washerTotal) * 100) : 0;

  // Update text display with occupation rate and details
  dryerOccupationRateEl.textContent = `${dryerOccupationRate}% occupation rate`;
  dryerDetailsEl.textContent = `(${dryerRunning} running + ${dryerReady} ready + ${dryerOffline} offline out of ${dryerTotal} total)`;

  washerOccupationRateEl.textContent = `${washerOccupationRate}% occupation rate`;
  washerDetailsEl.textContent = `(${washerRunning} running + ${washerReady} ready + ${washerOffline} offline out of ${washerTotal} total)`;
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
  console.log("Starting refresh scheduling with random 30-60 second intervals");

  // Schedule first refresh
  scheduleNextRefresh(async () => {
    await fetchFromBackend();
    renderGrid();
    renderEta();
    renderSummary();
    renderUpdatedAt();
  });
}

// Event listeners
document.addEventListener("DOMContentLoaded", async () => {
  // Load machine configuration first
  await loadMachineConfig();
  // Then initialize the app
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

// Modal functions
let currentMachine = null;
let currentStopMachine = null;

/**
 * Open machine control modal
 */
function openMachineModal(machine) {
  if (machine.status !== "READY") {
    console.log("Machine is not ready:", machine.label);
    return;
  }

  currentMachine = machine;

  // Get machine label from mapping
  const machineLabel = MACHINE_ID_MAPPING[machine.id] || machine.label;

  console.log(`Opening modal for machine ${machine.id} -> ${machineLabel}`);

  // Update modal content
  document.getElementById("modalMachineLabel").textContent = machineLabel;
  document.getElementById("modalMachineBrand").textContent =
    machineBrands[machineLabel] || "Unknown";

  // Update machine icon based on type
  const icon = document.getElementById("modalMachineIcon");
  if (machine.type === "W") {
    // Washer icon
    icon.innerHTML =
      '<path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8H6V4zm0 10h5v6H6v-6zm7 0h5v6h-5v-6zm0-10h5v8h-5V4z"/>';
  } else {
    // Dryer icon
    icon.innerHTML =
      '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>';
  }

  // Reset duration input
  document.getElementById("durationInput").value = "1";

  // Show modal
  document.getElementById("machineModal").style.display = "flex";

  // Focus on duration input
  setTimeout(() => {
    document.getElementById("durationInput").focus();
  }, 100);
}

/**
 * Close machine control modal
 */
function closeMachineModal() {
  document.getElementById("machineModal").style.display = "none";
  currentMachine = null;
}

/**
 * Open stop machine modal
 */
function openStopModal(machine) {
  if (machine.status !== "RUNNING") {
    console.log("Machine is not running:", machine.label);
    return;
  }

  currentStopMachine = machine;

  // Get machine label from mapping
  const machineLabel = MACHINE_ID_MAPPING[machine.id] || machine.label;

  console.log(`Opening stop modal for machine ${machine.id} -> ${machineLabel}`);

  // Update modal content
  document.getElementById("stopModalMachineLabel").textContent = machineLabel;
  document.getElementById("stopModalMachineBrand").textContent =
    machineBrands[machineLabel] || "Unknown";

  // Update machine icon based on type
  const icon = document.getElementById("stopModalMachineIcon");
  if (machine.type === "W") {
    // Washer icon
    icon.innerHTML =
      '<path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8H6V4zm0 10h5v6H6v-6zm7 0h5v6h-5v-6zm0-10h5v8h-5V4z"/>';
  } else {
    // Dryer icon
    icon.innerHTML =
      '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>';
  }

  // Show modal
  document.getElementById("stopMachineModal").style.display = "flex";
}

/**
 * Close stop machine modal
 */
function closeStopModal() {
  document.getElementById("stopMachineModal").style.display = "none";
  currentStopMachine = null;
}

/**
 * Start machine with selected duration
 */
async function startMachine() {
  console.log("startMachine called, currentMachine:", currentMachine);

  if (!currentMachine) {
    console.error("currentMachine is null!");
    alert("Error: Tidak ada mesin yang dipilih");
    return;
  }

  const durationInput = document.getElementById("durationInput");
  const duration = parseInt(durationInput.value);

  if (!duration || duration < 1 || duration > 180) {
    alert("Durasi harus antara 1-180 menit");
    return;
  }

  // Get machine label from mapping
  const machineLabel =
    MACHINE_ID_MAPPING[currentMachine.id] || currentMachine.label;
  console.log(
    `Starting machine ${currentMachine.id} (${machineLabel}) for ${duration} minutes`
  );

  try {
    // Show loading state
    const startBtn = document.getElementById("modalStartBtn");
    const originalText = startBtn.innerHTML;
    startBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="animate-spin">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      Memulai...
    `;
    startBtn.disabled = true;

    // Make API call to start machine
    const response = await fetch(
      `${API_BASE}/api/machines/${currentMachine.id}/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...Auth.getAuthHeaders(),
        },
        body: JSON.stringify({
          duration: duration,
          program: "normal",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      // Success - close modal and show message
      closeMachineModal();
      alert(
        `Mesin ${machineLabel} berhasil dinyalakan untuk ${duration} menit!`
      );

      // Refresh data to show updated status
      await fetchFromBackend();
    } else {
      throw new Error(result.message || "Gagal menyalakan mesin");
    }
  } catch (error) {
    console.error("Error starting machine:", error);
    alert(`Gagal menyalakan mesin: ${error.message}`);
  } finally {
    // Reset button state
    const startBtn = document.getElementById("modalStartBtn");
    startBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
      Mulai Mesin
    `;
    startBtn.disabled = false;
  }
}

/**
 * Stop machine
 */
async function stopMachine() {
  console.log("stopMachine called, currentStopMachine:", currentStopMachine);

  if (!currentStopMachine) {
    console.error("currentStopMachine is null!");
    alert("Error: Tidak ada mesin yang dipilih");
    return;
  }

  // Get machine label from mapping
  const machineLabel =
    MACHINE_ID_MAPPING[currentStopMachine.id] || currentStopMachine.label;
  console.log(`Stopping machine ${currentStopMachine.id} (${machineLabel})`);

  try {
    // Show loading state
    const stopBtn = document.getElementById("stopModalStopBtn");
    const originalText = stopBtn.innerHTML;
    stopBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" class="animate-spin">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      Mematikan...
    `;
    stopBtn.disabled = true;

    // Make API call to stop machine
    const response = await fetch(
      `${API_BASE}/api/machines/${currentStopMachine.id}/stop`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...Auth.getAuthHeaders(),
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      // Success - close modal and show message
      closeStopModal();
      alert(`Mesin ${machineLabel} berhasil dimatikan!`);

      // Refresh data to show updated status
      await fetchFromBackend();
    } else {
      throw new Error(result.message || "Gagal mematikan mesin");
    }
  } catch (error) {
    console.error("Error stopping machine:", error);
    alert(`Gagal mematikan mesin: ${error.message}`);
  } finally {
    // Reset button state
    const stopBtn = document.getElementById("stopModalStopBtn");
    stopBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 6h12v12H6z" />
      </svg>
      Matikan Mesin
    `;
    stopBtn.disabled = false;
  }
}

// Modal event listeners
document.addEventListener("DOMContentLoaded", () => {
  // Close start modal buttons
  document
    .getElementById("modalCloseBtn")
    .addEventListener("click", closeMachineModal);
  document
    .getElementById("modalCancelBtn")
    .addEventListener("click", closeMachineModal);

  // Start machine button
  document
    .getElementById("modalStartBtn")
    .addEventListener("click", startMachine);

  // Close start modal when clicking overlay
  document.getElementById("machineModal").addEventListener("click", (e) => {
    if (e.target.id === "machineModal") {
      closeMachineModal();
    }
  });

  // Enter key to start machine
  document.getElementById("durationInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      startMachine();
    }
  });

  // Close stop modal buttons
  document
    .getElementById("stopModalCloseBtn")
    .addEventListener("click", closeStopModal);
  document
    .getElementById("stopModalCancelBtn")
    .addEventListener("click", closeStopModal);

  // Stop machine button
  document
    .getElementById("stopModalStopBtn")
    .addEventListener("click", stopMachine);

  // Close stop modal when clicking overlay
  document.getElementById("stopMachineModal").addEventListener("click", (e) => {
    if (e.target.id === "stopMachineModal") {
      closeStopModal();
    }
  });

  // Close modals with Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.getElementById("machineModal").style.display === "flex") {
        closeMachineModal();
      } else if (
        document.getElementById("stopMachineModal").style.display === "flex"
      ) {
        closeStopModal();
      }
    }
  });
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
    formatElapsedTime,
    getStatusText,
    updateDonutChart,
    openMachineModal,
    closeMachineModal,
    startMachine,
    openStopModal,
    closeStopModal,
    stopMachine,
  };
}
