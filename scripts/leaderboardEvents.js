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
        D01_OLD: "SQ",
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
        D01_OLD: 14,
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
        W10: 8,
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
// LeaderboardEvents Renderer
class LeaderboardEventsRenderer {
  constructor(dataManager) {
    this.dataManager = dataManager;
    // Default sort state: descending by total
    this.sortState = {
      washer: { key: "total", direction: "desc" },
      dryer: { key: "total", direction: "desc" },
    };
  }

  handleSort(tableType, key) {
    const currentSort = this.sortState[tableType];

    if (currentSort.key === key) {
      // Toggle direction
      this.sortState[tableType].direction =
        currentSort.direction === "desc" ? "asc" : "desc";
    } else {
      // New key, default to desc
      this.sortState[tableType] = { key: key, direction: "desc" };
    }

    this.updateSortIcons(tableType);
    this.renderTable();
  }

  updateSortIcons(tableType) {
    const headers = document.querySelectorAll(
      `th[data-table="${tableType}"][data-sort]`
    );
    const currentSort = this.sortState[tableType];

    headers.forEach((th) => {
      const icon = th.querySelector(".sort-icon");
      if (!icon) return;

      if (th.dataset.sort === currentSort.key) {
        icon.textContent = currentSort.direction === "asc" ? "↑" : "↓";
        icon.classList.remove("opacity-0");
        icon.classList.add("text-sky-600", "font-bold", "opacity-100");
      } else {
        icon.textContent = "↕";
        icon.classList.remove(
          "text-sky-600",
          "font-bold",
          "opacity-100"
        );
        icon.classList.add("opacity-0"); // Reset to hover-only visibility
      }
    });
  }

  renderTable() {
    if (!this.dataManager.eventsData?.data?.leaderboard) {
      console.log("⚠️ No data to render");
      this.showLoading();
      return;
    }

    const leaderboard = this.dataManager.eventsData.data.leaderboard;

    // Filter Washer (starts with W) and Dryer (starts with D)
    let washers = leaderboard.filter((item) =>
      item.machine_label.startsWith("W")
    );
    let dryers = leaderboard.filter((item) =>
      item.machine_label.startsWith("D")
    );

    // Apply Sorting
    washers = this.sortData(washers, this.sortState.washer);
    dryers = this.sortData(dryers, this.sortState.dryer);

    this.renderSingleTable(washers, "washer");
    this.renderSingleTable(dryers, "dryer");
    
    // Ensure icons are correct after render (e.g. on first load)
    this.updateSortIcons("washer");
    this.updateSortIcons("dryer");
  }

  sortData(data, sortConfig) {
    return [...data].sort((a, b) => {
      const valA = a[sortConfig.key] || 0;
      const valB = b[sortConfig.key] || 0;

      if (sortConfig.direction === "asc") {
        return valA - valB;
      } else {
        return valB - valA;
      }
    });
  }

  renderSingleTable(data, type) {
    const tableId = `${type}Table`;
    const tbodyId = `${type}TableBody`;
    const tfootId = `${type}TableFooter`;
    const loadingId = `${type}TableLoading`;
    const emptyId = `${type}TableEmpty`;
    const totalId = `total${
      type.charAt(0).toUpperCase() + type.slice(1)
    }Machines`;

    const table = document.getElementById(tableId);
    const tbody = document.getElementById(tbodyId);
    const tfoot = document.getElementById(tfootId);
    const loading = document.getElementById(loadingId);
    const empty = document.getElementById(emptyId);
    const totalEl = document.getElementById(totalId);
    const globalError = document.getElementById("globalTableError");

    // Reset states
    if (globalError) globalError.style.display = "none";
    if (loading) loading.style.display = "none";

    if (!data || data.length === 0) {
      if (table) table.style.display = "none";
      if (empty) empty.style.display = "block";
      if (totalEl) totalEl.textContent = "0";
      return;
    }

    if (empty) empty.style.display = "none";
    if (table) table.style.display = "table";
    if (totalEl)
      totalEl.textContent = this.dataManager.formatFrequency(data.length);

    // Render Body
    if (tbody) {
      tbody.innerHTML = "";
      data.forEach((item, index) => {
        // Rank logic: usually rank is position in sorted list. 
        // If sorting by non-default, visual rank is still 1, 2, 3...
        const row = this.createTableRow(item, index + 1);
        tbody.appendChild(row);
      });
    }

    // Calculate and Render Footer Totals
    if (tfoot) {
      const totals = data.reduce(
        (acc, item) => {
          acc.transaksi += item.transaksi || 0;
          acc.drop_off += item.drop_off || 0;
          acc.error_payment += item.error_payment || 0;
          acc.cuci_kosong += item.cuci_kosong || 0;
          acc.employee_quota += item.employee_quota || 0;
          acc.tube_clean += item.tube_clean || 0;
          acc.total += item.total || 0;
          return acc;
        },
        {
          transaksi: 0,
          drop_off: 0,
          error_payment: 0,
          cuci_kosong: 0,
          employee_quota: 0,
          tube_clean: 0,
          total: 0,
        }
      );

      tfoot.innerHTML = `
        <tr class="bg-gray-100 font-bold text-gray-900 sticky bottom-0 shadow-inner">
          <td class="px-4 py-3 text-left bg-gray-100" colspan="2">TOTAL</td>
          <td class="px-4 py-3 text-right bg-gray-100">${this.dataManager.formatFrequency(
            totals.transaksi
          )}</td>
          <td class="px-4 py-3 text-right bg-gray-100">${this.dataManager.formatFrequency(
            totals.drop_off
          )}</td>
          <td class="px-4 py-3 text-right bg-gray-100">${this.dataManager.formatFrequency(
            totals.error_payment
          )}</td>
          <td class="px-4 py-3 text-right bg-gray-100">${this.dataManager.formatFrequency(
            totals.cuci_kosong
          )}</td>
          <td class="px-4 py-3 text-right bg-gray-100">${this.dataManager.formatFrequency(
            totals.employee_quota
          )}</td>
          <td class="px-4 py-3 text-right bg-gray-100">${this.dataManager.formatFrequency(
            totals.tube_clean
          )}</td>
          <td class="px-4 py-3 text-right text-sky-700 font-extrabold bg-gray-100">${this.dataManager.formatFrequency(
            totals.total
          )}</td>
        </tr>
      `;
    }
  }

  createTableRow(item, rank) {
    const row = document.createElement("tr");
    row.className = rank % 2 === 0 ? "bg-white" : "bg-gray-50/50"; // Alternate row stripes for better read logic

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
    this.setSectionLoading("washer", true);
    this.setSectionLoading("dryer", true);
    const globalError = document.getElementById("globalTableError");
    if (globalError) globalError.style.display = "none";
  }

  setSectionLoading(type, isLoading) {
    const tableId = `${type}Table`;
    const loadingId = `${type}TableLoading`;
    const emptyId = `${type}TableEmpty`;

    const table = document.getElementById(tableId);
    const loading = document.getElementById(loadingId);
    const empty = document.getElementById(emptyId);

    if (isLoading) {
      if (table) table.style.display = "none";
      if (loading) loading.style.display = "block";
      if (empty) empty.style.display = "none";
    } else {
      if (loading) loading.style.display = "none";
    }
  }

  showError(message) {
    this.setSectionLoading("washer", false);
    this.setSectionLoading("dryer", false);

    const globalError = document.getElementById("globalTableError");
    if (globalError) {
      globalError.textContent = message || "Terjadi kesalahan saat memuat data";
      globalError.style.display = "block";
    }
  }

  updateDataRangeInfo() {
    const infoElement = document.getElementById("data-range-info");
    if (!infoElement || !this.dataManager.eventsData?.data) return;

    const { filter, start_date, end_date } = this.dataManager.eventsData.data;

    let rangeText = "";

    // Helper to format date with precision
    const formatDate = (dateStr) => {
      try {
        return new Date(dateStr).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      } catch (e) {
        console.warn("Date formatting error", e);
        return dateStr;
      }
    };

    if (start_date && end_date) {
      const startStr = formatDate(start_date);
      const endStr = formatDate(end_date);

      if (startStr === endStr) {
        rangeText = startStr;
      } else {
        // Calculate duration logic
        let durationStr = "";
        const s = new Date(start_date);
        const e = new Date(end_date);
        const diffTime = e - s;
        if (diffTime >= 0) {
           const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
           durationStr = `${diffDays} hari`;
           if (diffDays >= 7) {
             const weeks = Math.floor(diffDays / 7);
             const remainingDays = diffDays % 7;
             durationStr += ` (${weeks} minggu${remainingDays > 0 ? ` ${remainingDays} hari` : ""})`;
           }
           durationStr = ` • ${durationStr}`;
        }
        rangeText = `${startStr} - ${endStr}${durationStr}`;
      }
    } else {
      // Fallback relative text
      const filterMap = {
        today: "Hari Ini",
        yesterday: "Kemarin",
        this_week: "Minggu Ini",
        last_7_days: "7 Hari Terakhir",
        this_month: "Bulan Ini",
        this_year: "Tahun Ini",
      };
      rangeText = filterMap[filter] || "Memuat data...";
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
    
    // Sort Headers
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", (e) => {
        // Find closest th in case user clicked inner element
        const header = e.target.closest("th");
        if (header) {
          const tableType = header.dataset.table;
          const sortKey = header.dataset.sort;
          if (tableType && sortKey) {
            this.renderer.handleSort(tableType, sortKey);
          }
        }
      });
    });

    const startDateInput = document.getElementById("startDate");
    const endDateInput = document.getElementById("endDate");
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
