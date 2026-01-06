/**
 * Status Monitoring Page
 * Fetches and displays system status from monitoring API
 */

// API Base URL
const API_BASE = window.location.origin;

// State
let currentData = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  loadStatusData();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById("refreshBtn").addEventListener("click", () => {
    loadStatusData();
  });

  document.getElementById("daysFilter").addEventListener("change", (e) => {
    loadStatusData(parseInt(e.target.value));
  });
}

async function loadStatusData(days = 7) {
  const loadingOverlay = document.getElementById("loadingOverlay");
  loadingOverlay.style.display = "flex";

  try {
    const response = await fetch(
      `${API_BASE}/api/monitoring/status?days=${days}&limit=100`
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || "Failed to load status");
    }

    currentData = result.data;
    renderStatus(currentData);
    updateLastUpdate(currentData);
  } catch (error) {
    console.error("Error loading status:", error);
    showError("Failed to load status data. Please try again.");
  } finally {
    loadingOverlay.style.display = "none";
  }
}

function renderStatus(data) {
  renderOverallStatus(data);
  renderMachines(data.uptime?.machines || []);
  renderIncidents(data.recent_incidents || []);
  renderHistory(data.incidents_by_date || {});
}

function renderOverallStatus(data) {
  const statusBadge = document.getElementById("statusBadge");
  const statusText = document.getElementById("statusText");
  const overallUptime = document.getElementById("overallUptime");

  const status = data.status || "operational";
  const uptime = data.uptime?.overall_uptime_percent || 100;

  // Update status badge
  statusBadge.className = `px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 ${
    status === "operational"
      ? "bg-green-100 text-green-800"
      : status === "degraded"
      ? "bg-yellow-100 text-yellow-800"
      : "bg-red-100 text-red-800"
  }`;

  const statusDot = statusBadge.querySelector(".status-dot");
  statusDot.className = `status-dot w-2 h-2 rounded-full ${
    status === "operational"
      ? "bg-green-500"
      : status === "degraded"
      ? "bg-yellow-500"
      : "bg-red-500"
  }`;

  statusText.textContent =
    status === "operational"
      ? "Operational"
      : status === "degraded"
      ? "Degraded Performance"
      : "Service Disruption";

  // Update uptime
  overallUptime.textContent = `${uptime.toFixed(2)}%`;
  overallUptime.className = `text-3xl font-bold ${
    uptime >= 99.9
      ? "text-green-600"
      : uptime >= 99
      ? "text-yellow-600"
      : "text-red-600"
  }`;
}

function renderMachines(machines) {
  const grid = document.getElementById("machinesGrid");
  grid.innerHTML = "";

  if (machines.length === 0) {
    grid.innerHTML =
      '<p class="text-slate-500 col-span-full text-center py-8">No machine data available</p>';
    return;
  }

  machines.forEach((machine) => {
    const card = document.createElement("div");
    card.className =
      "bg-white rounded-xl shadow-sm border border-slate-200 p-4 hover:shadow-md transition-shadow";

    const uptime = machine.uptime_percent || 100;
    const statusColor =
      uptime >= 99.9
        ? "text-green-600"
        : uptime >= 99
        ? "text-yellow-600"
        : "text-red-600";

    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-semibold text-slate-900">${
          machine.machine_label || machine.machine_id
        }</h3>
        <span class="text-xs px-2 py-1 rounded-full ${
          uptime >= 99.9
            ? "bg-green-100 text-green-800"
            : uptime >= 99
            ? "bg-yellow-100 text-yellow-800"
            : "bg-red-100 text-red-800"
        }">
          ${uptime.toFixed(2)}%
        </span>
      </div>
      <div class="space-y-1 text-sm">
        <div class="flex justify-between text-slate-600">
          <span>Uptime:</span>
          <span class="font-medium ${statusColor}">${uptime.toFixed(2)}%</span>
        </div>
        <div class="flex justify-between text-slate-600">
          <span>Incidents:</span>
          <span class="font-medium">${machine.total_incidents || 0}</span>
        </div>
        <div class="flex justify-between text-slate-600">
          <span>Critical:</span>
          <span class="font-medium text-red-600">${
            machine.critical_incidents || 0
          }</span>
        </div>
        <div class="flex justify-between text-slate-600">
          <span>Warning:</span>
          <span class="font-medium text-yellow-600">${
            machine.warning_incidents || 0
          }</span>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

function renderIncidents(incidents) {
  const list = document.getElementById("incidentsList");
  list.innerHTML = "";

  if (incidents.length === 0) {
    list.innerHTML = `
      <div class="p-8 text-center text-slate-500">
        <p>No incidents reported in the selected period.</p>
      </div>
    `;
    return;
  }

  incidents.forEach((incident) => {
    const item = document.createElement("div");
    item.className = "p-4 hover:bg-slate-50 transition-colors";

    const severityColor =
      incident.severity === "critical"
        ? "bg-red-100 text-red-800"
        : incident.severity === "warning"
        ? "bg-yellow-100 text-yellow-800"
        : "bg-blue-100 text-blue-800";

    const statusTransition = `${incident.old_status} → ${incident.new_status}`;
    // Format timestamp sama dengan example preview: "5 Jan 2026, 20:30"
    const timestamp = new Date(
      incident.created_at || incident.timestamp
    ).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    item.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="px-2 py-1 rounded text-xs font-medium ${severityColor}">
              ${incident.severity.toUpperCase()}
            </span>
            <span class="text-sm font-medium text-slate-900">
              ${incident.machine_label || incident.machine_id}
            </span>
          </div>
          <p class="text-sm text-slate-600 mb-1">
            Status changed: <span class="font-medium">${statusTransition}</span>
          </p>
          <p class="text-xs text-slate-500">
            ${incident.classification?.reason || "Status change detected"}
          </p>
          ${
            incident.raw_device_data?.ol === false
              ? '<p class="text-xs text-red-600 mt-1">⚠️ Device offline (ol: false)</p>'
              : ""
          }
        </div>
        <div class="text-xs text-slate-500 whitespace-nowrap">
          ${timestamp}
        </div>
      </div>
    `;

    list.appendChild(item);
  });
}

function renderHistory(incidentsByDate) {
  const container = document.getElementById("historyByDate");
  container.innerHTML = "";

  const dates = Object.keys(incidentsByDate).sort((a, b) => b.localeCompare(a));

  if (dates.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-500">
        <p>No history available for the selected period.</p>
      </div>
    `;
    return;
  }

  dates.forEach((date) => {
    const incidents = incidentsByDate[date];
    const dateObj = new Date(date);
    const formattedDate = dateObj.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const card = document.createElement("div");
    card.className =
      "bg-white rounded-xl shadow-sm border border-slate-200 p-6";

    const criticalCount = incidents.filter(
      (i) => i.severity === "critical"
    ).length;
    const warningCount = incidents.filter(
      (i) => i.severity === "warning"
    ).length;

    card.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-slate-900">${formattedDate}</h3>
        <div class="flex items-center gap-2">
          ${
            criticalCount > 0
              ? `<span class="text-xs px-2 py-1 rounded-full bg-red-100 text-red-800">${criticalCount} Critical</span>`
              : ""
          }
          ${
            warningCount > 0
              ? `<span class="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-800">${warningCount} Warning</span>`
              : ""
          }
          <span class="text-sm text-slate-500">${
            incidents.length
          } incidents</span>
        </div>
      </div>
      <div class="space-y-2">
        ${incidents
          .slice(0, 10)
          .map(
            (incident) => `
          <div class="flex items-center justify-between p-2 bg-slate-50 rounded text-sm">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${
                incident.severity === "critical"
                  ? "bg-red-500"
                  : incident.severity === "warning"
                  ? "bg-yellow-500"
                  : "bg-blue-500"
              }"></span>
              <span class="font-medium">${
                incident.machine_label || incident.machine_id
              }</span>
              <span class="text-slate-600">${incident.old_status} → ${
              incident.new_status
            }</span>
            </div>
            <span class="text-slate-500 text-xs">
              ${new Date(
                incident.created_at || incident.timestamp
              ).toLocaleTimeString("id-ID", {
                timeStyle: "short",
              })}
            </span>
          </div>
        `
          )
          .join("")}
        ${
          incidents.length > 10
            ? `<p class="text-xs text-slate-500 mt-2">+ ${
                incidents.length - 10
              } more incidents</p>`
            : ""
        }
      </div>
    `;

    container.appendChild(card);
  });
}

function updateLastUpdate(data) {
  const lastUpdateEl = document.getElementById("lastUpdate");
  if (!lastUpdateEl) return;

  const timeSpan = lastUpdateEl.querySelector("span");
  if (!timeSpan) return;

  // Last update time = waktu saat data di-fetch (current time)
  // Ini menunjukkan kapan data terakhir di-refresh, bukan timestamp incident
  const lastUpdateTime = new Date();

  timeSpan.textContent = lastUpdateTime.toLocaleTimeString("id-ID", {
    timeStyle: "medium",
  });
}

function showError(message) {
  const overallStatus = document.getElementById("overallStatus");
  overallStatus.innerHTML = `
    <div class="text-center py-8">
      <p class="text-red-600 font-medium">${message}</p>
      <button
        onclick="loadStatusData()"
        class="mt-4 px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors text-sm font-medium"
      >
        Retry
      </button>
    </div>
  `;
}

// Expose loadStatusData for retry button
window.loadStatusData = loadStatusData;
