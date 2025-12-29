// Machine Configuration - will be loaded from external file
let MACHINE_CONFIG = null;

// Helper functions
const getMachineBrand = (machineLabel) => {
  if (!MACHINE_CONFIG) return "Unknown";
  return MACHINE_CONFIG.machineBrands[machineLabel] || "Unknown";
};

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
        W10: "LG20",
        W10_OLD: "NTG",
        W11: "BEKO",
        W12: "BEKO",
      },
      machineMaxWeight: {
        D01: 14,
        D02: 14,
        D03: 6,
        D04: 6,
        D05: 7,
        D06: 7,
        D07: 7,
        D08: 7,
        D09: 7,
        D10: 5,
        D11: 5,
        D12: 5,
        W01: 14,
        W02: 14,
        W03: 8,
        W04: 8,
        W05: 7,
        W06: 7,
        W07: 6,
        W08: 6,
        W09: 6,
        W10: 6,
        W10_OLD: 5,
        W11: 4,
        W12: 4,
      },
    };
  }
}

// Leaderboard Events API Client
class LeaderboardEventsAPI {
  constructor() {
    // Use API_CONFIG for consistent API URL handling
    this.apiBase = window.API_CONFIG
      ? window.API_CONFIG.getBaseUrl()
      : "http://localhost:3000";
    this.isLoading = false;
    this.lastETag = null;
  }

  async fetchWithTimeout(url, options = {}, timeout = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async getEventsLeaderboard(filter, startDate, endDate) {
    const params = new URLSearchParams();
    if (filter) {
      params.append("filter", filter);
    }
    if (startDate) {
      params.append("start_date", startDate);
    }
    if (endDate) {
      params.append("end_date", endDate);
    }

    const url = `${this.apiBase}/api/leaderboard-events?${params}`;

    try {
      const headers = {
        ...Auth.getAuthHeaders(),
      };
      if (this.lastETag) {
        headers["If-None-Match"] = this.lastETag;
      }

      const response = await this.fetchWithTimeout(url, { headers });

      if (response.status === 304) {
        console.log("📦 Events leaderboard unchanged (304), using cached data");
        return null;
      }

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      const newETag = response.headers.get("ETag");
      if (newETag) {
        this.lastETag = newETag;
      }

      console.log("✅ Events leaderboard received:", data);
      return data;
    } catch (error) {
      console.error("❌ Error fetching events leaderboard:", error);
      if (error.name === "AbortError") {
        throw new Error(
          "Request timeout - events leaderboard API took too long to respond"
        );
      }
      throw error;
    }
  }
}

// Leaderboard Events Data Manager
class LeaderboardEventsDataManager {
  constructor() {
    this.api = new LeaderboardEventsAPI();
    this.currentFilter = {
      filter: "today",
      startDate: null,
      endDate: null,
    };
    this.eventsData = null;
  }

  getCurrentDate() {
    const now = new Date();
    return now.toISOString().split("T")[0];
  }

  updateFilter(newFilter) {
    this.currentFilter = { ...this.currentFilter, ...newFilter };
    console.log("🔄 Filter updated:", this.currentFilter);
  }

  setLoading(loading) {
    this.isLoading = loading;
    const overlay = document.getElementById("loadingOverlay");

    // Show/hide loading overlay
    if (overlay) {
      if (loading) {
        overlay.style.display = "flex";
      } else {
        overlay.style.display = "none";
      }
    }

    // Also handle refresh button
    const refreshBtn = document.getElementById("refreshEvents");
    if (refreshBtn) {
      refreshBtn.classList.toggle("loading", loading);
      refreshBtn.disabled = loading;
    }
  }

  showError(message) {
    console.error("❌ Error:", message);
    // You can add UI error display here
  }

  async loadData() {
    this.setLoading(true);

    try {
      const { filter, startDate, endDate } = this.currentFilter;

      const data = await this.api.getEventsLeaderboard(
        filter,
        startDate,
        endDate
      );

      // Only update if we got new data (not 304)
      if (data) {
        this.eventsData = data;
      }

      console.log("✅ Events leaderboard data loaded successfully:", {
        machines: this.eventsData?.data?.leaderboard?.length || 0,
        updated: !!data,
      });

      return this.eventsData;
    } catch (error) {
      console.error("❌ Failed to load events leaderboard data:", error);
      this.showError("Gagal memuat data events leaderboard: " + error.message);
      throw error;
    } finally {
      this.setLoading(false);
    }
  }

  // Format frequency
  formatFrequency(count) {
    return new Intl.NumberFormat("id-ID").format(count || 0);
  }
}

// Leaderboard Events Renderer
class LeaderboardEventsRenderer {
  constructor(dataManager) {
    this.dataManager = dataManager;
  }

  renderTable() {
    if (!this.dataManager.eventsData?.data?.leaderboard) {
      console.log("⚠️ No data to render");
      this.showLoading();
      return;
    }

    const leaderboard = this.dataManager.eventsData.data.leaderboard;
    const tbody = document.getElementById("eventsTableBody");
    const table = document.getElementById("eventsTable");
    const loading = document.getElementById("eventsTableLoading");
    const error = document.getElementById("eventsTableError");
    const empty = document.getElementById("eventsTableEmpty");

    // Hide loading, error, empty states
    if (loading) loading.style.display = "none";
    if (error) error.style.display = "none";
    if (empty) empty.style.display = "none";

    if (!leaderboard || leaderboard.length === 0) {
      if (empty) empty.style.display = "block";
      if (table) table.style.display = "none";
      if (document.getElementById("totalMachines")) {
        document.getElementById("totalMachines").textContent = "0";
      }
      return;
    }

    // Show table
    if (table) table.style.display = "table";

    // Clear existing rows
    if (tbody) {
      tbody.innerHTML = "";
    }

    // Render rows
    leaderboard.forEach((item, index) => {
      const row = this.createTableRow(item, index + 1);
      if (tbody) {
        tbody.appendChild(row);
      }
    });

    // Update total machines
    if (document.getElementById("totalMachines")) {
      document.getElementById("totalMachines").textContent =
        this.dataManager.formatFrequency(leaderboard.length);
    }
  }

  createTableRow(item, rank) {
    const row = document.createElement("tr");
    row.className = rank <= 3 ? "bg-gray-50" : "";

    const rankClass = this.getRankClass(rank);
    const machineBrand = getMachineBrand(item.machine_label);
    const machineMaxWeight = getMachineMaxWeight(item.machine_label);

    row.innerHTML = `
      <td class="px-4 py-3 whitespace-nowrap">
        <div class="rank ${rankClass} inline-flex">${rank}</div>
      </td>
      <td class="px-4 py-3 whitespace-nowrap">
        <div class="flex flex-col">
          <div class="font-semibold text-gray-900">${item.machine_label}</div>
          <div class="flex gap-1 mt-1">
            <span class="machine-brand">${machineBrand}</span>
            <span class="machine-weight">${machineMaxWeight}kg</span>
          </div>
          <div class="text-xs text-gray-500 font-mono mt-1">${
            item.machine_id
          }</div>
        </div>
      </td>
      <td class="px-4 py-3 whitespace-nowrap text-right font-semibold text-gray-900">
        ${this.dataManager.formatFrequency(item.transaksi)}
      </td>
      <td class="px-4 py-3 whitespace-nowrap text-right text-gray-700">
        ${this.dataManager.formatFrequency(item.drop_off)}
      </td>
      <td class="px-4 py-3 whitespace-nowrap text-right text-gray-700">
        ${this.dataManager.formatFrequency(item.error_payment)}
      </td>
      <td class="px-4 py-3 whitespace-nowrap text-right text-gray-700">
        ${this.dataManager.formatFrequency(item.cuci_kosong)}
      </td>
      <td class="px-4 py-3 whitespace-nowrap text-right text-gray-700">
        ${this.dataManager.formatFrequency(item.employee_quota)}
      </td>
      <td class="px-4 py-3 whitespace-nowrap text-right text-gray-700">
        ${this.dataManager.formatFrequency(item.tube_clean)}
      </td>
      <td class="px-4 py-3 whitespace-nowrap text-right font-bold text-sky-600">
        ${this.dataManager.formatFrequency(item.total)}
      </td>
    `;

    return row;
  }

  getRankClass(rank) {
    if (rank === 1) return "rank-1";
    if (rank === 2) return "rank-2";
    if (rank === 3) return "rank-3";
    return "rank-other";
  }

  showLoading() {
    const table = document.getElementById("eventsTable");
    const loading = document.getElementById("eventsTableLoading");
    const error = document.getElementById("eventsTableError");
    const empty = document.getElementById("eventsTableEmpty");

    if (table) table.style.display = "none";
    if (loading) loading.style.display = "block";
    if (error) error.style.display = "none";
    if (empty) empty.style.display = "none";
  }

  showError(message) {
    const table = document.getElementById("eventsTable");
    const loading = document.getElementById("eventsTableLoading");
    const error = document.getElementById("eventsTableError");
    const empty = document.getElementById("eventsTableEmpty");

    if (table) table.style.display = "none";
    if (loading) loading.style.display = "none";
    if (error) {
      error.textContent = message || "Terjadi kesalahan saat memuat data";
      error.style.display = "block";
    }
    if (empty) empty.style.display = "none";
  }

  updateDataRangeInfo() {
    const infoElement = document.getElementById("data-range-info");
    if (!infoElement || !this.dataManager.eventsData?.data) return;

    const { filter, start_date, end_date } = this.dataManager.eventsData.data;

    let rangeText = "";
    if (filter === "today") {
      rangeText = "Hari Ini";
    } else if (filter === "yesterday") {
      rangeText = "Kemarin";
    } else if (filter === "this_week") {
      rangeText = "Minggu Ini";
    } else if (filter === "last_7_days") {
      rangeText = "7 Hari Terakhir";
    } else if (filter === "this_month") {
      rangeText = "Bulan Ini";
    } else if (filter === "this_year") {
      rangeText = "Tahun Ini";
    } else if (filter === "custom" && start_date && end_date) {
      const start = new Date(start_date).toLocaleDateString("id-ID");
      const end = new Date(end_date).toLocaleDateString("id-ID");
      rangeText = `Periode: ${start} - ${end}`;
    } else {
      rangeText = "Memuat data...";
    }

    infoElement.innerHTML = `
      <div class="range-text">${rangeText}</div>
    `;
  }
}

// Leaderboard Events Controller
class LeaderboardEventsController {
  constructor() {
    this.dataManager = new LeaderboardEventsDataManager();
    this.renderer = new LeaderboardEventsRenderer(this.dataManager);
    this.initializeEventListeners();
    this.initializeFilters();
    this.initializeApp();
  }

  async initializeApp() {
    // Load machine configuration first
    await loadMachineConfig();
    // Then load initial data
    this.loadInitialData();
  }

  initializeEventListeners() {
    // Refresh button
    document.getElementById("refreshEvents")?.addEventListener("click", () => {
      this.refreshData();
    });

    // Apply filter button
    document.getElementById("applyFilter")?.addEventListener("click", () => {
      this.applyFilter();
    });

    // Filter select change
    document.getElementById("filterSelect")?.addEventListener("change", () => {
      this.handleFilterChange();
    });
  }

  initializeFilters() {
    // Set default filter
    const filterSelect = document.getElementById("filterSelect");
    if (filterSelect) {
      filterSelect.value = "today";
    }
    this.handleFilterChange();
  }

  handleFilterChange() {
    const filterSelect = document.getElementById("filterSelect");
    const customDateGroup = document.getElementById("customDateGroup");
    const customDateGroup2 = document.getElementById("customDateGroup2");

    if (!filterSelect) return;

    const filter = filterSelect.value;

    // Show/hide custom date inputs
    if (filter === "custom") {
      if (customDateGroup) customDateGroup.style.display = "block";
      if (customDateGroup2) customDateGroup2.style.display = "block";
    } else {
      if (customDateGroup) customDateGroup.style.display = "none";
      if (customDateGroup2) customDateGroup2.style.display = "none";
    }
  }

  async applyFilter() {
    const filterSelect = document.getElementById("filterSelect");
    const startDateInput = document.getElementById("startDate");
    const endDateInput = document.getElementById("endDate");

    if (!filterSelect) return;

    const filter = filterSelect.value;
    let startDate = null;
    let endDate = null;

    if (filter === "custom") {
      if (startDateInput) startDate = startDateInput.value;
      if (endDateInput) endDate = endDateInput.value;

      if (!startDate || !endDate) {
        alert("Harap pilih tanggal awal dan tanggal akhir untuk filter custom");
        return;
      }
    }

    this.dataManager.updateFilter({
      filter,
      startDate,
      endDate,
    });

    await this.loadInitialData();
  }

  async loadInitialData() {
    try {
      this.renderer.showLoading();
      await this.dataManager.loadData();
      this.renderer.renderTable();
      this.renderer.updateDataRangeInfo();
    } catch (error) {
      this.renderer.showError(error.message);
    }
  }

  async refreshData() {
    await this.loadInitialData();
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    new LeaderboardEventsController();
  });
} else {
  new LeaderboardEventsController();
}
