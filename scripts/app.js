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
  "483FDA6AFDC7": "W10_OLD",
  "8CAAB556EF34": "W09",
  "500291EB8F36": "W10",
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
        W10: "LG24",
        W10_OLD: "NTG",
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
        W10_OLD: 10,
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

// Gateway base URL - defaults to localhost:54990 (gateway port)
// For production (Vercel), use EVENT_GATEWAY_BASE env var or default gateway URL
// Gateway runs on different port/host than frontend
const GATEWAY_BASE = onFile
  ? "http://localhost:54990"
  : onPort3000 || onVercel
  ? (typeof process !== "undefined" && process.env?.EVENT_GATEWAY_BASE) ||
    (typeof window !== "undefined" && window.location?.hostname === "localhost"
      ? "http://localhost:54990"
      : "http://194.233.72.89:54990") // Gateway production URL
  : "http://localhost:54990";

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
    // Use event delegation to check if click is on badge
    if (machine.status === "READY") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", (e) => {
        // Don't trigger if click is on badge
        if (
          e.target.classList.contains("machine-badge") ||
          e.target.closest(".machine-badge")
        ) {
          return;
        }
        openMachineModal(machine);
      });
    } else if (machine.status === "RUNNING") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", (e) => {
        // Don't trigger if click is on badge
        if (
          e.target.classList.contains("machine-badge") ||
          e.target.closest(".machine-badge")
        ) {
          return;
        }
        openStopModal(machine);
      });
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

      // Add badge (QR or DO) for RUNNING machines
      // DO for aid === "BOS", QR for other aid values
      const badge = document.createElement("div");
      badge.className = "machine-badge";

      // Check if aid is "BOS" or undefined (case-insensitive, trimmed)
      // undefined/null means it's not a QR payment (BOS = Boss/Manual)
      const aidValue = machine.aid
        ? String(machine.aid).trim().toUpperCase()
        : "";

      // Setup badge asynchronously (will update once event cache is fetched)
      setupMachineBadge(badge, machine);

      machineElement.appendChild(badge); // Append to machineElement after content
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
    // Use event delegation to check if click is on badge
    if (machine.status === "READY") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", (e) => {
        // Don't trigger if click is on badge
        if (
          e.target.classList.contains("machine-badge") ||
          e.target.closest(".machine-badge")
        ) {
          return;
        }
        openMachineModal(machine);
      });
    } else if (machine.status === "RUNNING") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", (e) => {
        // Don't trigger if click is on badge
        if (
          e.target.classList.contains("machine-badge") ||
          e.target.closest(".machine-badge")
        ) {
          return;
        }
        openStopModal(machine);
      });
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

      // Add badge (QR or DO) for RUNNING machines
      // DO for aid === "BOS", QR for other aid values
      const badge = document.createElement("div");
      badge.className = "machine-badge";

      // Check if aid is "BOS" or undefined (case-insensitive, trimmed)
      // undefined/null means it's not a QR payment (BOS = Boss/Manual)
      const aidValue = machine.aid
        ? String(machine.aid).trim().toUpperCase()
        : "";

      // Setup badge asynchronously (will update once event cache is fetched)
      setupMachineBadge(badge, machine);

      machineElement.appendChild(badge); // Append to machineElement after content
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
    // Use event delegation to check if click is on badge
    if (machine.status === "READY") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", (e) => {
        // Don't trigger if click is on badge
        if (
          e.target.classList.contains("machine-badge") ||
          e.target.closest(".machine-badge")
        ) {
          return;
        }
        openMachineModal(machine);
      });
    } else if (machine.status === "RUNNING") {
      machineElement.style.cursor = "pointer";
      machineElement.addEventListener("click", (e) => {
        // Don't trigger if click is on badge
        if (
          e.target.classList.contains("machine-badge") ||
          e.target.closest(".machine-badge")
        ) {
          return;
        }
        openStopModal(machine);
      });
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

      // Add badge (QR or DO) for RUNNING machines
      // DO for aid === "BOS", QR for other aid values
      const badge = document.createElement("div");
      badge.className = "machine-badge";

      // Check if aid is "BOS" or undefined (case-insensitive, trimmed)
      // undefined/null means it's not a QR payment (BOS = Boss/Manual)
      const aidValue = machine.aid
        ? String(machine.aid).trim().toUpperCase()
        : "";

      // Setup badge asynchronously (will update once event cache is fetched)
      setupMachineBadge(badge, machine);

      machineElement.appendChild(badge); // Append to machineElement after content
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
 * Fetch transaction detail by idtransaksi (aid)
 */
async function fetchTransactionDetail(idtransaksi) {
  try {
    const url = `${API_BASE}/api/transaction-detail?idtransaksi=${encodeURIComponent(
      idtransaksi
    )}`;

    // Use Auth.getAuthHeaders() if available, otherwise use manual token
    const headers = {
      "Content-Type": "application/json",
      ...(typeof Auth !== "undefined" ? Auth.getAuthHeaders() : {}),
    };

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error fetching transaction detail:", error);
    throw error;
  }
}

/**
 * Setup badge for machine based on aid and event cache
 * This function handles both BOS (event-based) and QR badges
 */
async function setupMachineBadge(badge, machine) {
  // Check if aid is "BOS" or undefined (case-insensitive, trimmed)
  const aidValue = machine.aid ? String(machine.aid).trim().toUpperCase() : "";

  // For BOS aid, get event type from cache to determine badge
  if (
    aidValue === "BOS" ||
    !machine.aid ||
    machine.aid === null ||
    machine.aid === undefined
  ) {
    // Get event cache to determine badge type (do/qe/mt/ep)
    const eventCache = await getMachineEvent(machine.id);
    if (eventCache && eventCache.valid) {
      // Show event type badge (do/qe/mt/ep)
      const badgeText = eventCache.event_type.toUpperCase();
      badge.textContent = badgeText;
      badge.classList.add("machine-badge-clickable");
      badge.addEventListener("click", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        await showEventTooltip(
          badge,
          eventCache.event_type,
          eventCache.event_id
        );
      });
      badge.addEventListener("mousedown", (e) => {
        e.stopPropagation();
      });
      badge.addEventListener("mouseup", (e) => {
        e.stopPropagation();
      });
    } else {
      // No valid event cache, show default DO
      badge.textContent = "DO";
    }
  } else if (aidValue !== "UNKNOWN" && machine.aid) {
    badge.textContent = "QR";
    // QR badge is clickable
    badge.classList.add("machine-badge-clickable");
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      showTransactionTooltip(badge, machine.aid);
    });
    badge.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    badge.addEventListener("mouseup", (e) => {
      e.stopPropagation();
    });
  } else {
    // UNKNOWN or other cases - show QR but not clickable
    badge.textContent = "QR";
  }

  // Prevent badge from triggering hover on card mesin
  badge.addEventListener("mouseenter", (e) => {
    e.stopPropagation();
  });
  badge.addEventListener("mouseleave", (e) => {
    e.stopPropagation();
  });
}

/**
 * Get machine event cache from gateway
 */
async function getMachineEvent(machineId) {
  try {
    const response = await fetch(
      `${GATEWAY_BASE}/api/machines/${machineId}/event`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      console.warn(
        `Failed to get machine event for ${machineId}: ${response.status}`
      );
      return null;
    }

    const result = await response.json();
    if (result.success && result.data && result.data.valid) {
      return result.data;
    }
    return null;
  } catch (error) {
    console.error(`Error getting machine event for ${machineId}:`, error);
    return null;
  }
}

/**
 * Get event detail from gateway
 */
async function getEventDetail(eventType, eventId) {
  try {
    // Map cache event type to API event type
    const apiEventType =
      {
        do: "drop-off",
        qe: "employee-quota",
        mt: "maintenance",
        ep: "error-payment",
      }[eventType] || eventType;

    const response = await fetch(
      `${GATEWAY_BASE}/api/events/${apiEventType}/${eventId}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    return result.data || result;
  } catch (error) {
    console.error(
      `Error getting event detail (${eventType}/${eventId}):`,
      error
    );
    throw error;
  }
}

/**
 * Show event tooltip when event badge is clicked
 */
async function showEventTooltip(badgeElement, eventType, eventId) {
  // Remove existing tooltip if any
  const existingTooltip = document.getElementById("event-tooltip");
  if (existingTooltip) {
    existingTooltip.remove();
  }

  // Create tooltip element
  const tooltip = document.createElement("div");
  tooltip.id = "event-tooltip";
  tooltip.className = "transaction-tooltip";
  tooltip.innerHTML = `
    <div class="tooltip-content">
      <div class="tooltip-loading">Memuat data...</div>
    </div>
  `;

  // Position tooltip relative to badge
  const badgeRect = badgeElement.getBoundingClientRect();
  document.body.appendChild(tooltip);

  // Position tooltip
  const tooltipRect = tooltip.getBoundingClientRect();
  let top = badgeRect.bottom + 8;
  let left = badgeRect.left + badgeRect.width / 2 - tooltipRect.width / 2;

  // Adjust if tooltip goes off screen
  if (left < 8) left = 8;
  if (left + tooltipRect.width > window.innerWidth - 8) {
    left = window.innerWidth - tooltipRect.width - 8;
  }
  if (top + tooltipRect.height > window.innerHeight - 8) {
    top = badgeRect.top - tooltipRect.height - 8;
  }

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;

  // Close tooltip when clicking outside
  const closeTooltip = (e) => {
    if (!tooltip.contains(e.target) && e.target !== badgeElement) {
      tooltip.remove();
      document.removeEventListener("click", closeTooltip);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", closeTooltip);
  }, 100);

  // Fetch event detail
  try {
    const detail = await getEventDetail(eventType, eventId);

    // Build tooltip content based on event type
    let content = "";
    const eventTypeNames = {
      do: "Drop-off",
      qe: "Employee Quota",
      mt: "Maintenance",
      ep: "Error Payment",
    };
    const eventName = eventTypeNames[eventType] || eventType;

    if (eventType === "do") {
      content = `
        <div class="tooltip-header">Detail ${eventName}</div>
        <div class="tooltip-item">
          <span class="tooltip-label">Pelanggan:</span>
          <span class="tooltip-value">${detail.customer_name || "N/A"}</span>
        </div>
        ${
          detail.customer_phone
            ? `
        <div class="tooltip-item">
          <span class="tooltip-label">Telepon:</span>
          <span class="tooltip-value">${detail.customer_phone}</span>
        </div>
        `
            : ""
        }
        ${
          detail.employee_id && detail.employee_id !== 0
            ? `
        <div class="tooltip-item">
          <span class="tooltip-label">Karyawan ID:</span>
          <span class="tooltip-value">${detail.employee_id}</span>
        </div>
        `
            : detail.other_employee_name
            ? `
        <div class="tooltip-item">
          <span class="tooltip-label">Karyawan:</span>
          <span class="tooltip-value">${detail.other_employee_name}</span>
        </div>
        `
            : ""
        }
        <div class="tooltip-item">
          <span class="tooltip-label">Durasi:</span>
          <span class="tooltip-value">${detail.duration_minutes} menit</span>
        </div>
        <div class="tooltip-item">
          <span class="tooltip-label">Waktu:</span>
          <span class="tooltip-value">${new Date(
            detail.occurred_at
          ).toLocaleString("id-ID")}</span>
        </div>
      `;
    } else if (eventType === "qe") {
      content = `
        <div class="tooltip-header">Detail ${eventName}</div>
        <div class="tooltip-item">
          <span class="tooltip-label">Karyawan:</span>
          <span class="tooltip-value">${detail.employee_name || "N/A"}</span>
        </div>
        <div class="tooltip-item">
          <span class="tooltip-label">Durasi:</span>
          <span class="tooltip-value">${detail.duration_minutes} menit</span>
        </div>
        <div class="tooltip-item">
          <span class="tooltip-label">Waktu:</span>
          <span class="tooltip-value">${new Date(
            detail.occurred_at
          ).toLocaleString("id-ID")}</span>
        </div>
      `;
    } else if (eventType === "mt") {
      // Map mtype to readable text
      const mtypeMap = {
        cuci_kosong: "Cuci Kosong",
        tube_clean: "Tube Clean",
        other: "Lainnya",
      };
      const mtypeText = mtypeMap[detail.mtype] || detail.mtype || "N/A";

      content = `
        <div class="tooltip-header">Detail ${eventName}</div>
        <div class="tooltip-item">
          <span class="tooltip-label">Jenis:</span>
          <span class="tooltip-value">${mtypeText}</span>
        </div>
        ${
          detail.employee_id && detail.employee_id !== 0
            ? `
        <div class="tooltip-item">
          <span class="tooltip-label">Karyawan ID:</span>
          <span class="tooltip-value">${detail.employee_id}</span>
        </div>
        `
            : detail.other_employee_name
            ? `
        <div class="tooltip-item">
          <span class="tooltip-label">Karyawan:</span>
          <span class="tooltip-value">${detail.other_employee_name}</span>
        </div>
        `
            : ""
        }
        ${
          detail.note
            ? `
        <div class="tooltip-item">
          <span class="tooltip-label">Catatan:</span>
          <span class="tooltip-value">${detail.note}</span>
        </div>
        `
            : ""
        }
        <div class="tooltip-item">
          <span class="tooltip-label">Durasi:</span>
          <span class="tooltip-value">${detail.duration_minutes} menit</span>
        </div>
        <div class="tooltip-item">
          <span class="tooltip-label">Waktu:</span>
          <span class="tooltip-value">${new Date(
            detail.occurred_at
          ).toLocaleString("id-ID")}</span>
        </div>
      `;
    } else if (eventType === "ep") {
      content = `
        <div class="tooltip-header">Detail ${eventName}</div>
        <div class="tooltip-item">
          <span class="tooltip-label">Deskripsi:</span>
          <span class="tooltip-value">${detail.description || "N/A"}</span>
        </div>
        ${
          detail.employee_id && detail.employee_id !== 0
            ? `
        <div class="tooltip-item">
          <span class="tooltip-label">Karyawan ID:</span>
          <span class="tooltip-value">${detail.employee_id}</span>
        </div>
        `
            : detail.other_employee_name
            ? `
        <div class="tooltip-item">
          <span class="tooltip-label">Karyawan:</span>
          <span class="tooltip-value">${detail.other_employee_name}</span>
        </div>
        `
            : ""
        }
        <div class="tooltip-item">
          <span class="tooltip-label">Durasi:</span>
          <span class="tooltip-value">${detail.duration_minutes} menit</span>
        </div>
        <div class="tooltip-item">
          <span class="tooltip-label">Waktu:</span>
          <span class="tooltip-value">${new Date(
            detail.occurred_at
          ).toLocaleString("id-ID")}</span>
        </div>
      `;
    }

    // Update tooltip content
    tooltip.innerHTML = `
      <div class="tooltip-content">
        ${content}
      </div>
    `;

    // Reposition after content update
    const updatedTooltipRect = tooltip.getBoundingClientRect();
    let updatedTop = badgeRect.bottom + 8;
    let updatedLeft =
      badgeRect.left + badgeRect.width / 2 - updatedTooltipRect.width / 2;

    if (updatedLeft < 8) updatedLeft = 8;
    if (updatedLeft + updatedTooltipRect.width > window.innerWidth - 8) {
      updatedLeft = window.innerWidth - updatedTooltipRect.width - 8;
    }
    if (updatedTop + updatedTooltipRect.height > window.innerHeight - 8) {
      updatedTop = badgeRect.top - updatedTooltipRect.height - 8;
    }

    tooltip.style.top = `${updatedTop}px`;
    tooltip.style.left = `${updatedLeft}px`;
  } catch (error) {
    console.error("Error fetching event detail:", error);
    tooltip.innerHTML = `
      <div class="tooltip-content">
        <div class="tooltip-error">Gagal memuat detail event</div>
      </div>
    `;
  }
}

/**
 * Show transaction tooltip when QR badge is clicked
 */
async function showTransactionTooltip(badgeElement, idtransaksi) {
  // Remove existing tooltip if any
  const existingTooltip = document.getElementById("transaction-tooltip");
  if (existingTooltip) {
    existingTooltip.remove();
  }

  // Create tooltip element
  const tooltip = document.createElement("div");
  tooltip.id = "transaction-tooltip";
  tooltip.className = "transaction-tooltip";
  tooltip.innerHTML = `
    <div class="tooltip-content">
      <div class="tooltip-loading">Memuat data...</div>
    </div>
  `;

  // Position tooltip relative to badge
  const badgeRect = badgeElement.getBoundingClientRect();
  document.body.appendChild(tooltip);

  // Position tooltip
  const tooltipRect = tooltip.getBoundingClientRect();
  let top = badgeRect.bottom + 8;
  let left = badgeRect.left + badgeRect.width / 2 - tooltipRect.width / 2;

  // Adjust if tooltip goes off screen
  if (left < 8) left = 8;
  if (left + tooltipRect.width > window.innerWidth - 8) {
    left = window.innerWidth - tooltipRect.width - 8;
  }
  if (top + tooltipRect.height > window.innerHeight - 8) {
    top = badgeRect.top - tooltipRect.height - 8;
  }

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;

  // Close tooltip when clicking outside
  const closeTooltip = (e) => {
    if (!tooltip.contains(e.target) && e.target !== badgeElement) {
      tooltip.remove();
      document.removeEventListener("click", closeTooltip);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", closeTooltip);
  }, 100);

  // Fetch transaction detail
  try {
    const detail = await fetchTransactionDetail(idtransaksi);
    const rincianLayanan = detail.data?.rincian_layanan || [];

    // Extract layanan names
    const layananList = [];
    if (Array.isArray(rincianLayanan)) {
      rincianLayanan.forEach((rincian) => {
        if (rincian.nama_layanan) {
          layananList.push(String(rincian.nama_layanan));
        }
      });
    }

    const layananText =
      layananList.length > 0 ? layananList.join(", ") : "Tidak ada layanan";

    // Update tooltip content
    tooltip.innerHTML = `
      <div class="tooltip-content">
        <div class="tooltip-header">Detail Transaksi</div>
        <div class="tooltip-item">
          <span class="tooltip-label">Layanan:</span>
          <span class="tooltip-value">${layananText}</span>
        </div>
        <div class="tooltip-item">
          <span class="tooltip-label">ID Transaksi:</span>
          <span class="tooltip-value">${idtransaksi}</span>
        </div>
      </div>
    `;

    // Reposition after content update
    const updatedTooltipRect = tooltip.getBoundingClientRect();
    let updatedTop = badgeRect.bottom + 8;
    let updatedLeft =
      badgeRect.left + badgeRect.width / 2 - updatedTooltipRect.width / 2;

    if (updatedLeft < 8) updatedLeft = 8;
    if (updatedLeft + updatedTooltipRect.width > window.innerWidth - 8) {
      updatedLeft = window.innerWidth - updatedTooltipRect.width - 8;
    }
    if (updatedTop + updatedTooltipRect.height > window.innerHeight - 8) {
      updatedTop = badgeRect.top - updatedTooltipRect.height - 8;
    }

    tooltip.style.top = `${updatedTop}px`;
    tooltip.style.left = `${updatedLeft}px`;
  } catch (error) {
    tooltip.innerHTML = `
      <div class="tooltip-content">
        <div class="tooltip-error">Gagal memuat data transaksi</div>
        <div class="tooltip-item">
          <span class="tooltip-label">ID Transaksi:</span>
          <span class="tooltip-value">${idtransaksi}</span>
        </div>
      </div>
    `;
  }
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
 * Render status legend with separate counts for washer and dryer
 */
function renderStatusLegend() {
  // Calculate washer counts
  const washers = machines.filter((m) => m.type === MACHINE_TYPE.WASHER);
  const washerReady = washers.filter((m) => m.status === STATUS.READY).length;
  const washerRunning = washers.filter(
    (m) => m.status === STATUS.RUNNING
  ).length;
  const washerOffline = washers.filter(
    (m) => m.status === STATUS.OFFLINE
  ).length;

  // Calculate dryer counts
  const dryers = machines.filter((m) => m.type === MACHINE_TYPE.DRYER);
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
      aid: m.aid || null, // Include aid field for badge logic
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
    renderSummary();
    renderStatusLegend();
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
async function openMachineModal(machine) {
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

  // Reset event form
  resetEventForm();

  // Setup maintenance radio buttons if maintenance is selected
  const eventTypeSelect = document.getElementById("eventTypeSelect");
  if (eventTypeSelect) {
    // Default to drop-off and show form
    eventTypeSelect.value = "drop-off";
    updateEventFormFields();
  }

  // Update button state (initially disabled until form is filled)
  updateStartButtonState();

  // Show modal first so dropdowns are available
  document.getElementById("machineModal").style.display = "flex";

  // Populate employee dropdowns if not already populated
  // Wait a bit to ensure DOM is ready
  setTimeout(async () => {
    if (employeesList.length === 0) {
      await fetchEmployees();
    } else {
      populateEmployeeDropdowns(employeesList);
    }
  }, 50);

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
  resetEventForm();
}

/**
 * Check if all mandatory fields are filled
 * Returns true if form is valid, false otherwise
 */
function isFormValid() {
  const eventTypeSelect = document.getElementById("eventTypeSelect");
  const eventType = eventTypeSelect?.value || "";
  const durationInput = document.getElementById("durationInput");
  const duration = parseInt(durationInput?.value || "0");

  // Check duration (must be between 1-180)
  if (!duration || duration < 1 || duration > 180) {
    return false;
  }

  // Check event type (required)
  if (!eventType) {
    return false;
  }

  // Check mandatory fields based on event type
  switch (eventType) {
    case "drop-off": {
      const customerName =
        document.getElementById("customerName")?.value.trim() || "";
      const employeeId =
        document.getElementById("employeeSelectDropOff")?.value || "";
      if (!customerName || !employeeId) return false;
      // If employee_id is 0, check otherEmployeeName
      if (employeeId === "0") {
        const otherEmployeeName =
          document.getElementById("otherEmployeeNameDropOff")?.value.trim() ||
          "";
        return otherEmployeeName.length > 0;
      }
      return true;
    }
    case "error-payment": {
      const errorDescription =
        document.getElementById("errorDescription")?.value.trim() || "";
      const employeeId =
        document.getElementById("employeeSelectErrorPayment")?.value || "";
      if (!errorDescription || !employeeId) return false;
      // If employee_id is 0, check otherEmployeeName
      if (employeeId === "0") {
        const otherEmployeeName =
          document
            .getElementById("otherEmployeeNameErrorPayment")
            ?.value.trim() || "";
        return otherEmployeeName.length > 0;
      }
      return true;
    }
    case "employee-quota": {
      const employeeName =
        document.getElementById("employeeName")?.value.trim() || "";
      return employeeName.length > 0;
    }
    case "maintenance": {
      const maintenanceType = document.querySelector(
        'input[name="maintenanceType"]:checked'
      )?.value;
      const employeeId =
        document.getElementById("employeeSelectMaintenance")?.value || "";
      if (!maintenanceType || !employeeId) return false;
      // If employee_id is 0, check otherEmployeeName
      if (employeeId === "0") {
        const otherEmployeeName =
          document
            .getElementById("otherEmployeeNameMaintenance")
            ?.value.trim() || "";
        return otherEmployeeName.length > 0;
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * Update start button state based on form validity
 */
function updateStartButtonState() {
  const startBtn = document.getElementById("modalStartBtn");
  if (!startBtn) return;

  const isValid = isFormValid();
  startBtn.disabled = !isValid;

  // CSS already handles disabled state styling via :disabled pseudo-class
  // No need to manually set opacity/cursor
}

/**
 * Update event form fields based on selected event type
 */
function updateEventFormFields() {
  const eventTypeSelect = document.getElementById("eventTypeSelect");
  const eventType = eventTypeSelect?.value || "";

  // Hide all event form sections
  document.getElementById("eventFormDropOff").style.display = "none";
  document.getElementById("eventFormErrorPayment").style.display = "none";
  document.getElementById("eventFormEmployeeQuota").style.display = "none";
  document.getElementById("eventFormMaintenance").style.display = "none";

  // Show relevant form section based on event type
  const durationInput = document.getElementById("durationInput");

  // Event type is required, so we must have a valid selection
  if (!eventType) {
    // If no event type, default to drop-off
    eventTypeSelect.value = "drop-off";
    eventType = "drop-off";
  }

  switch (eventType) {
    case "drop-off":
      document.getElementById("eventFormDropOff").style.display = "block";
      // Reset duration to default if not maintenance
      if (durationInput) durationInput.value = "1";
      // Handle employee dropdown visibility
      handleEmployeeDropdownChange("drop-off");
      break;
    case "error-payment":
      document.getElementById("eventFormErrorPayment").style.display = "block";
      // Reset duration to default if not maintenance
      if (durationInput) durationInput.value = "1";
      // Handle employee dropdown visibility
      handleEmployeeDropdownChange("error-payment");
      break;
    case "employee-quota":
      document.getElementById("eventFormEmployeeQuota").style.display = "block";
      // Reset duration to default if not maintenance
      if (durationInput) durationInput.value = "1";
      break;
    case "maintenance":
      document.getElementById("eventFormMaintenance").style.display = "block";
      // Setup maintenance radio buttons based on machine type
      setupMaintenanceRadioButtons();
      // Update duration based on selected maintenance type
      updateDurationForMaintenance();
      // Handle employee dropdown visibility
      handleEmployeeDropdownChange("maintenance");
      break;
    default:
      // Fallback to drop-off if invalid
      eventTypeSelect.value = "drop-off";
      document.getElementById("eventFormDropOff").style.display = "block";
      if (durationInput) durationInput.value = "1";
      // Handle employee dropdown visibility
      handleEmployeeDropdownChange("drop-off");
      break;
  }

  // Update button state after form fields change
  updateStartButtonState();
}

/**
 * Setup maintenance radio buttons based on machine type
 */
function setupMaintenanceRadioButtons() {
  if (!currentMachine) return;

  const maintenanceTypeCuciKosong = document.getElementById(
    "maintenanceTypeCuciKosong"
  );
  const maintenanceTypeTubeClean = document.getElementById(
    "maintenanceTypeTubeClean"
  );
  const maintenanceTypeOther = document.getElementById("maintenanceTypeOther");

  if (
    !maintenanceTypeCuciKosong ||
    !maintenanceTypeTubeClean ||
    !maintenanceTypeOther
  ) {
    return;
  }

  const isDryer = currentMachine.type === "D";
  const isWasher = currentMachine.type === "W";

  if (isDryer) {
    // Dryer: default = other, disable cuci_kosong and tube_clean
    maintenanceTypeCuciKosong.disabled = true;
    maintenanceTypeTubeClean.disabled = true;
    maintenanceTypeOther.disabled = false;

    // Set other as default if nothing is checked
    if (!maintenanceTypeOther.checked) {
      maintenanceTypeOther.checked = true;
    }
  } else if (isWasher) {
    // Washer: default = cuci_kosong, disable other
    maintenanceTypeCuciKosong.disabled = false;
    maintenanceTypeTubeClean.disabled = false;
    maintenanceTypeOther.disabled = true;

    // Set cuci_kosong as default if nothing is checked
    if (
      !maintenanceTypeCuciKosong.checked &&
      !maintenanceTypeTubeClean.checked
    ) {
      maintenanceTypeCuciKosong.checked = true;
    }
  }
}

/**
 * Update duration based on selected maintenance type
 */
function updateDurationForMaintenance() {
  const maintenanceType = document.querySelector(
    'input[name="maintenanceType"]:checked'
  )?.value;
  const durationInput = document.getElementById("durationInput");

  if (!durationInput) return;

  if (maintenanceType === "cuci_kosong") {
    durationInput.value = "90";
  } else if (maintenanceType === "tube_clean") {
    durationInput.value = "180";
  } else if (maintenanceType === "other") {
    // For "other", keep current value or default to 1
    if (!durationInput.value || durationInput.value === "1") {
      durationInput.value = "1";
    }
  }

  // Update button state after duration change
  updateStartButtonState();
}

// Global variable to cache employees list
let employeesList = [];

/**
 * Fetch employees from API
 */
async function fetchEmployees() {
  try {
    const response = await fetch(`${API_BASE}/api/employees?is_active=true`, {
      headers: {
        ...Auth.getAuthHeaders(),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log("📦 Employees API response:", result);

    // Handle different response structures
    let employees = null;
    if (result.success && result.data) {
      // Try result.data.data first (nested structure)
      if (Array.isArray(result.data.data)) {
        employees = result.data.data;
      }
      // Try result.data if it's an array directly
      else if (Array.isArray(result.data)) {
        employees = result.data;
      }
    }
    // Try result directly if it's an array
    else if (Array.isArray(result)) {
      employees = result;
    }

    if (employees && employees.length > 0) {
      employeesList = employees;
      console.log(
        `✅ Loaded ${employeesList.length} employees:`,
        employeesList
      );
      // Populate dropdowns after fetching
      populateEmployeeDropdowns(employeesList);
      return employeesList;
    } else {
      console.warn("⚠️ Invalid employees response format or empty:", result);
      employeesList = [];
      return [];
    }
  } catch (error) {
    console.warn("⚠️ Failed to fetch employees:", error);
    employeesList = [];
    return [];
  }
}

/**
 * Populate employee dropdowns with employees list
 */
function populateEmployeeDropdowns(employees) {
  const dropdowns = [
    "employeeSelectDropOff",
    "employeeSelectErrorPayment",
    "employeeSelectMaintenance",
  ];

  console.log("🔄 Populating employee dropdowns with:", employees);

  dropdowns.forEach((dropdownId) => {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) {
      console.warn(`⚠️ Dropdown ${dropdownId} not found`);
      return;
    }

    // Clear existing options
    dropdown.innerHTML = "";

    // Add default option
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Pilih karyawan...";
    dropdown.appendChild(defaultOption);

    // Separate "Lainnya" (id=0) from other employees
    const regularEmployees = employees.filter(
      (emp) => emp.id !== "0" && emp.id !== 0
    );
    const lainnyaEmployee = employees.find(
      (emp) => emp.id === "0" || emp.id === 0
    );

    // Add regular employees first
    regularEmployees.forEach((employee) => {
      const option = document.createElement("option");
      option.value = String(employee.id); // Ensure it's a string
      option.textContent = employee.employee_nickname || employee.employee_name;
      dropdown.appendChild(option);
      console.log(
        `  ✓ Added employee: ${option.value} - ${option.textContent}`
      );
    });

    // Always add "Lainnya" (id=0) at the end, even if it exists in the list
    const lainnyaOption = document.createElement("option");
    lainnyaOption.value = "0";
    lainnyaOption.textContent = lainnyaEmployee
      ? lainnyaEmployee.employee_nickname || lainnyaEmployee.employee_name
      : "Lainnya";
    dropdown.appendChild(lainnyaOption);
    console.log(
      `  ✓ Added Lainnya: ${lainnyaOption.value} - ${lainnyaOption.textContent}`
    );

    console.log(
      `✅ Populated ${dropdownId} with ${regularEmployees.length + 1} options`
    );
  });
}

/**
 * Handle employee dropdown change to show/hide otherEmployeeName field
 */
function handleEmployeeDropdownChange(eventType) {
  let dropdownId, otherNameGroupId, otherNameInputId;

  switch (eventType) {
    case "drop-off":
      dropdownId = "employeeSelectDropOff";
      otherNameGroupId = "otherEmployeeNameGroupDropOff";
      otherNameInputId = "otherEmployeeNameDropOff";
      break;
    case "error-payment":
      dropdownId = "employeeSelectErrorPayment";
      otherNameGroupId = "otherEmployeeNameGroupErrorPayment";
      otherNameInputId = "otherEmployeeNameErrorPayment";
      break;
    case "maintenance":
      dropdownId = "employeeSelectMaintenance";
      otherNameGroupId = "otherEmployeeNameGroupMaintenance";
      otherNameInputId = "otherEmployeeNameMaintenance";
      break;
    default:
      return;
  }

  const dropdown = document.getElementById(dropdownId);
  const otherNameGroup = document.getElementById(otherNameGroupId);
  const otherNameInput = document.getElementById(otherNameInputId);

  if (!dropdown || !otherNameGroup || !otherNameInput) return;

  const selectedValue = dropdown.value;
  if (selectedValue === "0") {
    // Show otherEmployeeName field when "Lainnya" is selected
    otherNameGroup.style.display = "block";
    otherNameInput.required = true;
  } else {
    // Hide otherEmployeeName field for regular employees
    otherNameGroup.style.display = "none";
    otherNameInput.required = false;
    otherNameInput.value = ""; // Clear the value
  }

  // Update button state after change
  updateStartButtonState();
}

/**
 * Reset event form to default state
 */
function resetEventForm() {
  // Reset dropdown to default (drop-off)
  const eventTypeSelect = document.getElementById("eventTypeSelect");
  if (eventTypeSelect) {
    eventTypeSelect.value = "drop-off";
  }

  // Clear all input fields
  document.getElementById("customerName").value = "";
  document.getElementById("customerPhone").value = "";
  document.getElementById("errorDescription").value = "";
  document.getElementById("employeeName").value = "";

  // Reset employee dropdowns
  const employeeDropdowns = [
    "employeeSelectDropOff",
    "employeeSelectErrorPayment",
    "employeeSelectMaintenance",
  ];
  employeeDropdowns.forEach((id) => {
    const dropdown = document.getElementById(id);
    if (dropdown) dropdown.value = "";
  });

  // Hide and clear otherEmployeeName fields
  const otherNameGroups = [
    "otherEmployeeNameGroupDropOff",
    "otherEmployeeNameGroupErrorPayment",
    "otherEmployeeNameGroupMaintenance",
  ];
  const otherNameInputs = [
    "otherEmployeeNameDropOff",
    "otherEmployeeNameErrorPayment",
    "otherEmployeeNameMaintenance",
  ];
  otherNameGroups.forEach((id) => {
    const group = document.getElementById(id);
    if (group) group.style.display = "none";
  });
  otherNameInputs.forEach((id) => {
    const input = document.getElementById(id);
    if (input) {
      input.value = "";
      input.required = false;
    }
  });

  // Reset maintenance type radio buttons
  const maintenanceTypeCuciKosong = document.getElementById(
    "maintenanceTypeCuciKosong"
  );
  const maintenanceTypeTubeClean = document.getElementById(
    "maintenanceTypeTubeClean"
  );
  const maintenanceTypeOther = document.getElementById("maintenanceTypeOther");

  if (maintenanceTypeCuciKosong) maintenanceTypeCuciKosong.checked = false;
  if (maintenanceTypeTubeClean) maintenanceTypeTubeClean.checked = false;
  if (maintenanceTypeOther) maintenanceTypeOther.checked = false;

  // Re-enable all radio buttons (will be disabled/enabled by setupMaintenanceRadioButtons)
  if (maintenanceTypeCuciKosong) maintenanceTypeCuciKosong.disabled = false;
  if (maintenanceTypeTubeClean) maintenanceTypeTubeClean.disabled = false;
  if (maintenanceTypeOther) maintenanceTypeOther.disabled = false;

  document.getElementById("maintenanceNote").value = "";

  // Hide all form sections
  updateEventFormFields();
}

/**
 * Collect event data from form
 * Returns null if validation fails, otherwise returns event data object
 * Event type is now required, so this will always return data if form is valid
 */
function collectEventData(machineId, duration) {
  const eventTypeSelect = document.getElementById("eventTypeSelect");
  const eventType = eventTypeSelect?.value || "";

  // Event type is required - show error if not selected
  if (!eventType) {
    alert(
      "⚠️ Event Wajib Dipilih\n\nAnda harus memilih jenis event sebelum menyalakan mesin.\n\nSilakan pilih salah satu event terlebih dahulu."
    );
    eventTypeSelect.focus();
    return null;
  }

  const baseData = {
    machine_id: machineId,
    duration_minutes: duration,
  };

  switch (eventType) {
    case "drop-off": {
      const customerName = document.getElementById("customerName").value.trim();
      if (!customerName) {
        alert(
          "⚠️ Field Wajib Kosong\n\nNama Pelanggan harus diisi untuk event Drop-off.\n\nSilakan isi nama pelanggan terlebih dahulu sebelum menyalakan mesin."
        );
        // Focus ke input field yang kosong
        document.getElementById("customerName").focus();
        return null;
      }
      const employeeId = parseInt(
        document.getElementById("employeeSelectDropOff").value
      );
      if (isNaN(employeeId)) {
        alert(
          "⚠️ Field Wajib Kosong\n\nKaryawan harus dipilih untuk event Drop-off.\n\nSilakan pilih karyawan terlebih dahulu sebelum menyalakan mesin."
        );
        document.getElementById("employeeSelectDropOff").focus();
        return null;
      }
      const otherEmployeeName =
        employeeId === 0
          ? document.getElementById("otherEmployeeNameDropOff").value.trim()
          : undefined;
      if (employeeId === 0 && !otherEmployeeName) {
        alert(
          "⚠️ Field Wajib Kosong\n\nNama Karyawan Lainnya harus diisi ketika memilih 'Lainnya'.\n\nSilakan isi nama karyawan lainnya terlebih dahulu sebelum menyalakan mesin."
        );
        document.getElementById("otherEmployeeNameDropOff").focus();
        return null;
      }
      return {
        type: "drop-off",
        data: {
          ...baseData,
          customer_name: customerName,
          customer_phone:
            document.getElementById("customerPhone").value.trim() || undefined,
          employee_id: employeeId,
          other_employee_name: otherEmployeeName,
        },
      };
    }
    case "error-payment": {
      const description = document
        .getElementById("errorDescription")
        .value.trim();
      if (!description) {
        alert(
          "⚠️ Field Wajib Kosong\n\nKeterangan Error harus diisi untuk event Error Payment.\n\nSilakan isi keterangan error terlebih dahulu sebelum menyalakan mesin."
        );
        // Focus ke input field yang kosong
        document.getElementById("errorDescription").focus();
        return null;
      }
      const employeeId = parseInt(
        document.getElementById("employeeSelectErrorPayment").value
      );
      if (isNaN(employeeId)) {
        alert(
          "⚠️ Field Wajib Kosong\n\nKaryawan harus dipilih untuk event Error Payment.\n\nSilakan pilih karyawan terlebih dahulu sebelum menyalakan mesin."
        );
        document.getElementById("employeeSelectErrorPayment").focus();
        return null;
      }
      const otherEmployeeName =
        employeeId === 0
          ? document
              .getElementById("otherEmployeeNameErrorPayment")
              .value.trim()
          : undefined;
      if (employeeId === 0 && !otherEmployeeName) {
        alert(
          "⚠️ Field Wajib Kosong\n\nNama Karyawan Lainnya harus diisi ketika memilih 'Lainnya'.\n\nSilakan isi nama karyawan lainnya terlebih dahulu sebelum menyalakan mesin."
        );
        document.getElementById("otherEmployeeNameErrorPayment").focus();
        return null;
      }
      return {
        type: "error-payment",
        data: {
          ...baseData,
          description: description,
          employee_id: employeeId,
          other_employee_name: otherEmployeeName,
        },
      };
    }
    case "employee-quota": {
      const employeeName = document.getElementById("employeeName").value.trim();
      if (!employeeName) {
        alert(
          "⚠️ Field Wajib Kosong\n\nNama Karyawan harus diisi untuk event Employee Quota.\n\nSilakan isi nama karyawan terlebih dahulu sebelum menyalakan mesin."
        );
        // Focus ke input field yang kosong
        document.getElementById("employeeName").focus();
        return null;
      }
      return {
        type: "employee-quota",
        data: {
          ...baseData,
          employee_name: employeeName,
        },
      };
    }
    case "maintenance": {
      const maintenanceType = document.querySelector(
        'input[name="maintenanceType"]:checked'
      )?.value;
      if (!maintenanceType) {
        alert(
          "⚠️ Field Wajib Kosong\n\nJenis Maintenance harus dipilih.\n\nSilakan pilih jenis maintenance terlebih dahulu sebelum menyalakan mesin."
        );
        return null;
      }
      const employeeId = parseInt(
        document.getElementById("employeeSelectMaintenance").value
      );
      if (isNaN(employeeId)) {
        alert(
          "⚠️ Field Wajib Kosong\n\nKaryawan harus dipilih untuk event Maintenance.\n\nSilakan pilih karyawan terlebih dahulu sebelum menyalakan mesin."
        );
        document.getElementById("employeeSelectMaintenance").focus();
        return null;
      }
      const otherEmployeeName =
        employeeId === 0
          ? document.getElementById("otherEmployeeNameMaintenance").value.trim()
          : undefined;
      if (employeeId === 0 && !otherEmployeeName) {
        alert(
          "⚠️ Field Wajib Kosong\n\nNama Karyawan Lainnya harus diisi ketika memilih 'Lainnya'.\n\nSilakan isi nama karyawan lainnya terlebih dahulu sebelum menyalakan mesin."
        );
        document.getElementById("otherEmployeeNameMaintenance").focus();
        return null;
      }
      return {
        type: "maintenance",
        data: {
          ...baseData,
          mtype: maintenanceType,
          note:
            document.getElementById("maintenanceNote").value.trim() ||
            undefined,
          employee_id: employeeId,
          other_employee_name: otherEmployeeName,
        },
      };
    }
    default:
      return null;
  }
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

  console.log(
    `Opening stop modal for machine ${machine.id} -> ${machineLabel}`
  );

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

  // Check if button is disabled (form validation)
  const startBtn = document.getElementById("modalStartBtn");
  if (startBtn && startBtn.disabled) {
    // Form is not valid, don't proceed
    return;
  }

  const durationInput = document.getElementById("durationInput");
  const duration = parseInt(durationInput.value);

  if (!duration || duration < 1 || duration > 180) {
    alert("Durasi harus antara 1-180 menit");
    updateStartButtonState(); // Update button state
    return;
  }

  // Collect event data (required - validation will show alert if failed)
  const eventData = collectEventData(currentMachine.id, duration);
  if (eventData === null) {
    // Validation failed - collectEventData already showed alert
    updateStartButtonState(); // Update button state
    return;
  }

  // Get machine label from mapping
  const machineLabel =
    MACHINE_ID_MAPPING[currentMachine.id] || currentMachine.label;
  console.log(
    `Starting machine ${currentMachine.id} (${machineLabel}) for ${duration} minutes`,
    eventData ? `with event: ${eventData.type}` : "without event"
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

    // Prepare request body - only duration (event creation is handled separately)
    const requestBody = {
      duration: duration,
      program: "normal",
    };

    // Make API call to start machine
    const response = await fetch(
      `${GATEWAY_BASE}/api/machines/${currentMachine.id}/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...Auth.getAuthHeaders(),
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      // Machine started successfully, now create event if eventData exists
      if (eventData) {
        try {
          // Import createEvent dynamically
          const { createEvent } = await import(
            "../src/services/eventService.js"
          );
          const eventResult = await createEvent(eventData);

          if (eventResult.success) {
            console.log("✅ Event created successfully after machine start");
          } else {
            console.warn(
              "⚠️ Machine started but event creation failed (will retry):",
              eventResult.message || eventResult.error
            );
            alert(
              `Mesin ${machineLabel} berhasil dinyalakan, tetapi pencatatan event gagal. Sistem akan mencoba lagi secara otomatis.`
            );
          }
        } catch (eventError) {
          console.error(
            "Error creating event after machine start:",
            eventError
          );
          alert(
            `Mesin ${machineLabel} berhasil dinyalakan, tetapi pencatatan event gagal. Sistem akan mencoba lagi secara otomatis.`
          );
        }
      }

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

    // Make API call to stop machine via gateway
    const response = await fetch(
      `${GATEWAY_BASE}/api/machines/${currentStopMachine.id}/stop`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
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

  // Event type dropdown listener
  const eventTypeSelect = document.getElementById("eventTypeSelect");
  if (eventTypeSelect) {
    eventTypeSelect.addEventListener("change", () => {
      updateEventFormFields();
      updateStartButtonState();
    });
  }

  // Employee dropdown listeners
  const employeeSelectDropOff = document.getElementById(
    "employeeSelectDropOff"
  );
  if (employeeSelectDropOff) {
    employeeSelectDropOff.addEventListener("change", () => {
      handleEmployeeDropdownChange("drop-off");
    });
  }

  const employeeSelectErrorPayment = document.getElementById(
    "employeeSelectErrorPayment"
  );
  if (employeeSelectErrorPayment) {
    employeeSelectErrorPayment.addEventListener("change", () => {
      handleEmployeeDropdownChange("error-payment");
    });
  }

  const employeeSelectMaintenance = document.getElementById(
    "employeeSelectMaintenance"
  );
  if (employeeSelectMaintenance) {
    employeeSelectMaintenance.addEventListener("change", () => {
      handleEmployeeDropdownChange("maintenance");
    });
  }

  // Other employee name input listeners for real-time validation
  const otherEmployeeNameDropOff = document.getElementById(
    "otherEmployeeNameDropOff"
  );
  if (otherEmployeeNameDropOff) {
    otherEmployeeNameDropOff.addEventListener("input", updateStartButtonState);
    otherEmployeeNameDropOff.addEventListener("change", updateStartButtonState);
  }

  const otherEmployeeNameErrorPayment = document.getElementById(
    "otherEmployeeNameErrorPayment"
  );
  if (otherEmployeeNameErrorPayment) {
    otherEmployeeNameErrorPayment.addEventListener(
      "input",
      updateStartButtonState
    );
    otherEmployeeNameErrorPayment.addEventListener(
      "change",
      updateStartButtonState
    );
  }

  const otherEmployeeNameMaintenance = document.getElementById(
    "otherEmployeeNameMaintenance"
  );
  if (otherEmployeeNameMaintenance) {
    otherEmployeeNameMaintenance.addEventListener(
      "input",
      updateStartButtonState
    );
    otherEmployeeNameMaintenance.addEventListener(
      "change",
      updateStartButtonState
    );
  }

  // Maintenance type radio button listeners
  document
    .querySelectorAll('input[name="maintenanceType"]')
    .forEach((radio) => {
      radio.addEventListener("change", () => {
        updateDurationForMaintenance();
        updateStartButtonState();
      });
    });

  // Mandatory field listeners for real-time validation
  const customerNameInput = document.getElementById("customerName");
  if (customerNameInput) {
    customerNameInput.addEventListener("input", updateStartButtonState);
    customerNameInput.addEventListener("change", updateStartButtonState);
  }

  const errorDescriptionInput = document.getElementById("errorDescription");
  if (errorDescriptionInput) {
    errorDescriptionInput.addEventListener("input", updateStartButtonState);
    errorDescriptionInput.addEventListener("change", updateStartButtonState);
  }

  const employeeNameInput = document.getElementById("employeeName");
  if (employeeNameInput) {
    employeeNameInput.addEventListener("input", updateStartButtonState);
    employeeNameInput.addEventListener("change", updateStartButtonState);
  }

  // Duration input listener
  const durationInput = document.getElementById("durationInput");
  if (durationInput) {
    durationInput.addEventListener("input", updateStartButtonState);
    durationInput.addEventListener("change", updateStartButtonState);
  }

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

  // Initialize employees on page load
  fetchEmployees().catch((error) => {
    console.warn("Failed to initialize employees:", error);
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
