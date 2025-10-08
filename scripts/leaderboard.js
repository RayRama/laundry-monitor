// Leaderboard API Client
class LeaderboardAPI {
  constructor() {
    // Determine base URL same as dashboard.js
    const onFile = window.location.origin.startsWith("file");
    const onPort3000 = window.location.port === "3000";
    const onVercel = window.location.hostname.includes("vercel.app");
    this.apiBase = onFile
      ? "http://localhost:3000"
      : onPort3000 || onVercel
      ? ""
      : "http://localhost:3000";
    this.isLoading = false;
    this.lastFrequencyETag = null;
    this.lastRevenueETag = null;
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

  async getFrequencyLeaderboard(params = {}) {
    const queryParams = new URLSearchParams(params);
    const url = `${this.apiBase}/api/leaderboard/frequency?${queryParams}`;

    try {
      const headers = { "cache-control": "no-cache" };
      if (this.lastFrequencyETag) {
        headers["If-None-Match"] = this.lastFrequencyETag;
      }

      const response = await this.fetchWithTimeout(url, { headers });

      if (response.status === 304) {
        console.log(
          "📦 Frequency leaderboard unchanged (304), using cached data"
        );
        return null;
      }

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      const newETag = response.headers.get("ETag");
      if (newETag) {
        this.lastFrequencyETag = newETag;
      }

      console.log("✅ Frequency leaderboard received:", data);
      return data;
    } catch (error) {
      console.error("❌ Error fetching frequency leaderboard:", error);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - leaderboard API took too long to respond');
      }
      throw error;
    }
  }

  async getRevenueLeaderboard(params = {}) {
    const queryParams = new URLSearchParams(params);
    const url = `${this.apiBase}/api/leaderboard/revenue?${queryParams}`;

    try {
      const headers = { "cache-control": "no-cache" };
      if (this.lastRevenueETag) {
        headers["If-None-Match"] = this.lastRevenueETag;
      }

      const response = await this.fetchWithTimeout(url, { headers });

      if (response.status === 304) {
        console.log(
          "📦 Revenue leaderboard unchanged (304), using cached data"
        );
        return null;
      }

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      const newETag = response.headers.get("ETag");
      if (newETag) {
        this.lastRevenueETag = newETag;
      }

      console.log("✅ Revenue leaderboard received:", data);
      return data;
    } catch (error) {
      console.error("❌ Error fetching revenue leaderboard:", error);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - leaderboard API took too long to respond');
      }
      throw error;
    }
  }
}

// Leaderboard Data Manager
class LeaderboardDataManager {
  constructor() {
    this.api = new LeaderboardAPI();
    this.currentFilter = {
      filterBy: "bulan",
      bulan: "2025-10",
      tanggalAwal: "2025-09-26",
      tanggalAkhir: this.getCurrentDate(),
      tahun: "2025",
    };
    this.frequencyData = null;
    this.revenueData = null;
  }

  getCurrentDate() {
    const now = new Date();
    return now.toISOString().split("T")[0];
  }

  getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
  }

  getCurrentYear() {
    return new Date().getFullYear().toString();
  }

  buildParams() {
    const params = {
      filter_by: this.currentFilter.filterBy,
    };

    if (this.currentFilter.filterBy === "periode") {
      params.tanggal_awal = this.currentFilter.tanggalAwal;
      params.tanggal_akhir = this.currentFilter.tanggalAkhir;
    } else if (this.currentFilter.filterBy === "bulan") {
      params.bulan = this.currentFilter.bulan;
    } else {
      params.tahun = this.currentFilter.tahun;
    }

    console.log("📊 Leaderboard params:", params);
    return params;
  }

  async loadData() {
    this.setLoading(true);

    try {
      const params = this.buildParams();

      // Fetch both leaderboards in parallel
      const [frequencyData, revenueData] = await Promise.all([
        this.api.getFrequencyLeaderboard(params),
        this.api.getRevenueLeaderboard(params),
      ]);

      // Only update if we got new data (not 304)
      if (frequencyData) {
        this.frequencyData = frequencyData;
      }

      if (revenueData) {
        this.revenueData = revenueData;
      }

      console.log("✅ Leaderboard data loaded successfully:", {
        frequency: this.frequencyData?.data?.length || 0,
        revenue: this.revenueData?.data?.length || 0,
        frequencyUpdated: !!frequencyData,
        revenueUpdated: !!revenueData,
      });

      return {
        frequency: this.frequencyData,
        revenue: this.revenueData,
      };
    } catch (error) {
      console.error("❌ Failed to load leaderboard data:", error);
      this.showError("Gagal memuat data leaderboard: " + error.message);
      throw error;
    } finally {
      this.setLoading(false);
    }
  }

  updateFilter(newFilter) {
    this.currentFilter = { ...this.currentFilter, ...newFilter };
    console.log("🔄 Filter updated:", this.currentFilter);
  }

  setLoading(loading) {
    this.isLoading = loading;
    const refreshBtn = document.getElementById("refreshLeaderboard");
    if (refreshBtn) {
      refreshBtn.classList.toggle("loading", loading);
      refreshBtn.disabled = loading;
    }
  }

  showError(message) {
    console.error("❌ Error:", message);
    // You can add UI error display here
  }

  // Separate data by machine type and recalculate ranks
  separateByMachineType(data) {
    if (!data?.data) return { washer: [], dryer: [] };

    const washer = [];
    const dryer = [];

    // Separate by machine type
    data.data.forEach((item) => {
      if (item.machineLabel.startsWith("W")) {
        washer.push(item);
      } else if (item.machineLabel.startsWith("D")) {
        dryer.push(item);
      }
    });

    // Recalculate ranks for each type separately
    const recalculateRanks = (items, sortBy) => {
      return items
        .sort((a, b) => {
          if (sortBy === "frequency") {
            return b.frequency - a.frequency;
          } else {
            return b.totalRevenue - a.totalRevenue;
          }
        })
        .map((item, index) => ({
          ...item,
          rank: index + 1,
        }));
    };

    return {
      washer: {
        frequency: recalculateRanks(washer, "frequency"),
        revenue: recalculateRanks(washer, "revenue"),
      },
      dryer: {
        frequency: recalculateRanks(dryer, "frequency"),
        revenue: recalculateRanks(dryer, "revenue"),
      },
    };
  }

  // Format currency
  formatCurrency(amount) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  // Format frequency
  formatFrequency(count) {
    return new Intl.NumberFormat("id-ID").format(count);
  }
}

// Leaderboard Renderer
class LeaderboardRenderer {
  constructor(dataManager) {
    this.dataManager = dataManager;
  }

  renderAll() {
    if (!this.dataManager.frequencyData || !this.dataManager.revenueData) {
      console.log("⚠️ No data to render");
      return;
    }

    this.renderFrequencyLeaderboards();
    this.renderRevenueLeaderboards();
    this.updateDataRangeInfo();
  }

  renderFrequencyLeaderboards() {
    const separatedData = this.dataManager.separateByMachineType(
      this.dataManager.frequencyData
    );

    this.renderLeaderboardList(
      "washerFrequencyList",
      separatedData.washer.frequency,
      "frequency"
    );
    this.renderLeaderboardList(
      "dryerFrequencyList",
      separatedData.dryer.frequency,
      "frequency"
    );

    // Update totals
    document.getElementById("washerFreqTotal").textContent =
      this.dataManager.formatFrequency(separatedData.washer.frequency.length);
    document.getElementById("dryerFreqTotal").textContent =
      this.dataManager.formatFrequency(separatedData.dryer.frequency.length);
  }

  renderRevenueLeaderboards() {
    const separatedData = this.dataManager.separateByMachineType(
      this.dataManager.revenueData
    );

    this.renderLeaderboardList(
      "washerRevenueList",
      separatedData.washer.revenue,
      "revenue"
    );
    this.renderLeaderboardList(
      "dryerRevenueList",
      separatedData.dryer.revenue,
      "revenue"
    );

    // Update totals
    const washerTotal = separatedData.washer.revenue.reduce(
      (sum, item) => sum + item.totalRevenue,
      0
    );
    const dryerTotal = separatedData.dryer.revenue.reduce(
      (sum, item) => sum + item.totalRevenue,
      0
    );

    document.getElementById("washerRevTotal").textContent =
      this.dataManager.formatCurrency(washerTotal);
    document.getElementById("dryerRevTotal").textContent =
      this.dataManager.formatCurrency(dryerTotal);
  }

  renderLeaderboardList(containerId, data, type) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="empty-state">Tidak ada data</div>';
      return;
    }

    const html = data
      .map((item) => this.createLeaderboardItem(item, type))
      .join("");
    container.innerHTML = html;
  }

  createLeaderboardItem(item, type) {
    const rankClass = this.getRankClass(item.rank);
    const isTopPerformer = item.rank <= 3;

    let primaryValue, secondaryValue;

    if (type === "frequency") {
      primaryValue = this.dataManager.formatFrequency(item.frequency);
      secondaryValue = this.dataManager.formatCurrency(item.totalRevenue);
    } else {
      primaryValue = this.dataManager.formatCurrency(item.totalRevenue);
      secondaryValue = this.dataManager.formatFrequency(item.frequency);
    }

    return `
      <div class="leaderboard-item ${isTopPerformer ? "top-performer" : ""}">
        <div class="rank ${rankClass}">${item.rank}</div>
        <div class="machine-info">
          <div class="machine-label">${item.machineLabel}</div>
          <div class="machine-id">${item.machineId}</div>
        </div>
        <div class="leaderboard-value">
          <div class="value-primary ${
            type === "frequency" ? "frequency" : "currency"
          }">${primaryValue}</div>
          <div class="value-secondary">${secondaryValue}</div>
        </div>
      </div>
    `;
  }

  getRankClass(rank) {
    if (rank === 1) return "rank-1";
    if (rank === 2) return "rank-2";
    if (rank === 3) return "rank-3";
    return "rank-other";
  }

  updateDataRangeInfo() {
    const infoElement = document.getElementById("data-range-info");
    if (!infoElement) return;

    const { filterBy, bulan, tanggalAwal, tanggalAkhir, tahun } =
      this.dataManager.currentFilter;

    let rangeText = "";
    if (filterBy === "periode") {
      rangeText = `Periode: ${tanggalAwal} - ${tanggalAkhir}`;
    } else if (filterBy === "bulan") {
      const [year, month] = bulan.split("-");
      const monthNames = [
        "Januari",
        "Februari",
        "Maret",
        "April",
        "Mei",
        "Juni",
        "Juli",
        "Agustus",
        "September",
        "Oktober",
        "November",
        "Desember",
      ];
      rangeText = `Bulan: ${monthNames[parseInt(month) - 1]} ${year}`;
    } else {
      rangeText = `Tahun: ${tahun}`;
    }

    infoElement.innerHTML = `
      <div class="range-text">${rangeText}</div>
    `;
  }
}

// Leaderboard Controller
class LeaderboardController {
  constructor() {
    this.dataManager = new LeaderboardDataManager();
    this.renderer = new LeaderboardRenderer(this.dataManager);
    this.initializeEventListeners();
    this.initializeFilters();
    this.loadInitialData();
  }

  initializeEventListeners() {
    // Refresh button
    document
      .getElementById("refreshLeaderboard")
      ?.addEventListener("click", () => {
        this.refreshData();
      });

    // Filter controls
    document.getElementById("filterBy")?.addEventListener("change", (e) => {
      this.updateFilterType(e.target.value);
    });

    document.getElementById("applyFilter")?.addEventListener("click", () => {
      this.applyFilter();
    });

    // Filter inputs
    ["bulan", "tanggalAwal", "tanggalAkhir", "tahun"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", () => {
        this.updateFilterFromInputs();
      });
    });
  }

  initializeFilters() {
    // Set default values
    const currentMonth = this.dataManager.getCurrentMonth();
    const currentDate = this.dataManager.getCurrentDate();

    document.getElementById("bulan").value = currentMonth;
    document.getElementById("tanggalAkhir").value = currentDate;
    document.getElementById("tahun").value = this.dataManager.getCurrentYear();
  }

  updateFilterType(filterBy) {
    // Hide all filter groups
    document.getElementById("bulanGroup").style.display = "none";
    document.getElementById("periodeGroup").style.display = "none";
    document.getElementById("periodeGroup2").style.display = "none";
    document.getElementById("tahunGroup").style.display = "none";

    // Show relevant filter group
    if (filterBy === "bulan") {
      document.getElementById("bulanGroup").style.display = "block";
    } else if (filterBy === "periode") {
      document.getElementById("periodeGroup").style.display = "block";
      document.getElementById("periodeGroup2").style.display = "block";
    } else if (filterBy === "tahun") {
      document.getElementById("tahunGroup").style.display = "block";
    }
  }

  updateFilterFromInputs() {
    const filterBy = document.getElementById("filterBy").value;
    const newFilter = { filterBy };

    if (filterBy === "bulan") {
      newFilter.bulan = document.getElementById("bulan").value;
    } else if (filterBy === "periode") {
      newFilter.tanggalAwal = document.getElementById("tanggalAwal").value;
      newFilter.tanggalAkhir = document.getElementById("tanggalAkhir").value;
    } else if (filterBy === "tahun") {
      newFilter.tahun = document.getElementById("tahun").value;
    }

    this.dataManager.updateFilter(newFilter);
  }

  applyFilter() {
    this.updateFilterFromInputs();
    this.refreshData();
  }

  async loadInitialData() {
    try {
      await this.dataManager.loadData();
      this.renderer.renderAll();
    } catch (error) {
      console.error("❌ Failed to load initial data:", error);
    }
  }

  async refreshData() {
    try {
      await this.dataManager.loadData();
      this.renderer.renderAll();
    } catch (error) {
      console.error("❌ Failed to refresh data:", error);
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 Initializing Leaderboard...");
  new LeaderboardController();
});
