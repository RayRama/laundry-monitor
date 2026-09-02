// Dashboard API Client
class DashboardAPI {
  constructor() {
    // Use API_CONFIG for consistent API URL handling
    this.apiBase = window.API_CONFIG
      ? window.API_CONFIG.getBaseUrl()
      : "http://localhost:3000";
    this.isLoading = false;
    this.lastSummaryETag = null;
    this.lastTransactionsETag = null;
  }

  async fetchWithTimeout(url, options = {}, timeout = 300000) {
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
      // Provide more informative error message for timeout
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        const timeoutError = new Error(
          `Request timeout setelah ${
            timeout / 1000
          } detik. Server mungkin sedang sibuk atau koneksi lambat.`
        );
        timeoutError.name = "TimeoutError";
        timeoutError.originalError = error;
        throw timeoutError;
      }
      throw error;
    }
  }

  async getTransactionSummary(params = {}) {
    const queryParams = new URLSearchParams(params);
    const url = `${this.apiBase}/api/transactions/summary?${queryParams}`;

    console.log("📊 Fetching transaction summary:", url);

    try {
      const headers = {
        "cache-control": "no-cache",
        ...Auth.getAuthHeaders(),
      };
      if (this.lastSummaryETag) {
        headers["If-None-Match"] = this.lastSummaryETag;
      }

      const response = await this.fetchWithTimeout(url, { headers });

      // Handle 304 Not Modified response
      if (response.status === 304) {
        console.log(
          "📦 Transaction summary unchanged (304), using cached data"
        );
        return null; // Indicate no new data
      }

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Update ETag from response
      const newETag = response.headers.get("ETag");
      if (newETag) {
        this.lastSummaryETag = newETag;
      }

      console.log("✅ Transaction summary received:", data);
      return data;
    } catch (error) {
      console.error("❌ Error fetching transaction summary:", error);
      // Provide user-friendly error message
      if (error.name === "TimeoutError") {
        throw new Error(
          "Waktu tunggu habis saat mengambil ringkasan transaksi. Silakan coba lagi atau periksa koneksi internet Anda."
        );
      }
      throw error;
    }
  }

  async getTransactions(params = {}) {
    const queryParams = new URLSearchParams(params);
    const url = `${this.apiBase}/api/transactions?${queryParams}`;

    console.log("📊 Fetching transactions:", url);

    try {
      const headers = {
        "cache-control": "no-cache",
        ...Auth.getAuthHeaders(),
      };
      if (this.lastTransactionsETag) {
        headers["If-None-Match"] = this.lastTransactionsETag;
      }

      const response = await this.fetchWithTimeout(url, { headers });

      // Handle 304 Not Modified response
      if (response.status === 304) {
        console.log("📦 Transactions unchanged (304), using cached data");
        return null; // Indicate no new data
      }

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Update ETag from response
      const newETag = response.headers.get("ETag");
      if (newETag) {
        this.lastTransactionsETag = newETag;
      }

      console.log(
        "✅ Transactions received:",
        data.data?.length || 0,
        "records"
      );
      return data;
    } catch (error) {
      console.error("❌ Error fetching transactions:", error);
      // Provide user-friendly error message
      if (error.name === "TimeoutError") {
        throw new Error(
          "Waktu tunggu habis saat mengambil data transaksi. Silakan coba lagi atau periksa koneksi internet Anda."
        );
      }
      throw error;
    }
  }

  /**
   * Satu panggilan berisi KPI, rollup grafik, dan `rows` baris teratas.
   *
   * Menggantikan pola lama getTransactions({limit: "max"}) yang menarik seluruh
   * baris periode -- puluhan ribu, belasan megabyte -- hanya untuk diagregasi
   * di browser lalu dibuang semuanya kecuali 100 baris teratas.
   */
  async getAnalytics({ tanggalAwal, tanggalAkhir, rows = 100 }) {
    const params = new URLSearchParams({
      tanggal_awal: tanggalAwal,
      tanggal_akhir: tanggalAkhir,
      rows: String(rows),
    });
    const url = `${this.apiBase}/api/transactions/analytics?${params}`;

    console.log("📊 Fetching analytics:", url);

    try {
      const response = await this.fetchWithTimeout(url, {
        headers: { "cache-control": "no-cache", ...Auth.getAuthHeaders() },
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log(
        `✅ Analytics: ${data.data?.kpi?.tx || 0} transaksi, ` +
          `${data.data?.rows?.length || 0} baris tabel, ` +
          `MV s/d ${data.meta?.covered_through}`
      );
      return data.data;
    } catch (error) {
      console.error("❌ Error fetching analytics:", error);
      if (error.name === "TimeoutError") {
        throw new Error(
          "Waktu tunggu habis saat mengambil ringkasan. Silakan coba lagi atau periksa koneksi internet Anda."
        );
      }
      throw error;
    }
  }
}

// Dashboard Data Manager
class DashboardDataManager {
  constructor() {
    this.api = new DashboardAPI();
    this.rawData = [];
    this.filteredData = [];
    this.analytics = null; // Agregat periode aktif dari server
    this.weeklyAnalytics = null; // Agregat untuk grafik mingguan (selalu minggu ini)
    this.monthlyAnalytics = null; // Agregat untuk grafik bulanan (selalu bulan ini)
    this.summary = null;
    const currentDate = this.getCurrentDate();
    this.currentFilter = {
      filterBy: "hari_ini",
      bulan: this.getCurrentMonth(),
      tahun: this.getCurrentYear(),
      tanggalAwal: currentDate,
      tanggalAkhir: currentDate,
      limit: "max",
    };
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

  getCurrentDate() {
    const now = new Date();
    // Use local timezone (Indonesia UTC+7) instead of UTC
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  getDefaultStartDate() {
    return "2025-09-22";
  }

  getTodayDate() {
    const today = new Date();
    // Use local timezone instead of UTC
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  getWeekStartDate() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust for Monday start
    const monday = new Date(today.getFullYear(), today.getMonth(), diff);
    // Use local timezone instead of UTC
    const year = monday.getFullYear();
    const month = String(monday.getMonth() + 1).padStart(2, "0");
    const day = String(monday.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  getMonthStartDate() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    // Use local timezone instead of UTC
    const year = firstDay.getFullYear();
    const month = String(firstDay.getMonth() + 1).padStart(2, "0");
    const day = String(firstDay.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  getDateRangeForFilter(filterBy) {
    const today = this.getCurrentDate();

    switch (filterBy) {
      case "hari_ini":
        return { tanggalAwal: today, tanggalAkhir: today };
      case "kemarin": {
        // Fix: Don't pass string to Date constructor, use current date object
        const now = new Date();
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const year = yesterday.getFullYear();
        const month = String(yesterday.getMonth() + 1).padStart(2, "0");
        const day = String(yesterday.getDate()).padStart(2, "0");
        const yesterdayStr = `${year}-${month}-${day}`;
        console.log(`📅 Kemarin date calculated: ${yesterdayStr}`);
        return { tanggalAwal: yesterdayStr, tanggalAkhir: yesterdayStr };
      }
      case "minggu_ini":
        return { tanggalAwal: this.getWeekStartDate(), tanggalAkhir: today };
      case "bulan_ini":
        return { tanggalAwal: this.getMonthStartDate(), tanggalAkhir: today };
      default:
        return null;
    }
  }

  // Helper: Calculate days difference between two dates
  getDaysDifference(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  // Helper: Check if filter period is suitable for weekly chart (>= 7 days or spans multiple weeks)
  isFilterSuitableForWeekly() {
    const filter = this.currentFilter;

    // If filter is "hari_ini" or "kemarin", not suitable
    if (filter.filterBy === "hari_ini" || filter.filterBy === "kemarin") {
      return false;
    }

    // If filter is "bulan" or "tahun", suitable
    if (filter.filterBy === "bulan" || filter.filterBy === "tahun") {
      return true;
    }

    // If filter is "periode", check date range
    if (
      filter.filterBy === "periode" &&
      filter.tanggalAwal &&
      filter.tanggalAkhir
    ) {
      const days = this.getDaysDifference(
        filter.tanggalAwal,
        filter.tanggalAkhir
      );
      // Suitable if >= 7 days
      return days >= 7;
    }

    // If filter is "minggu_ini" or "bulan_ini", suitable
    if (filter.filterBy === "minggu_ini" || filter.filterBy === "bulan_ini") {
      return true;
    }

    return false;
  }

  // Helper: Check if filter period is suitable for monthly chart (>= 30 days or spans multiple months)
  isFilterSuitableForMonthly() {
    const filter = this.currentFilter;

    // If filter is "hari_ini" or "kemarin", not suitable
    if (filter.filterBy === "hari_ini" || filter.filterBy === "kemarin") {
      return false;
    }

    // If filter is "bulan" or "tahun", suitable
    if (filter.filterBy === "bulan" || filter.filterBy === "tahun") {
      return true;
    }

    // If filter is "periode", check date range
    if (
      filter.filterBy === "periode" &&
      filter.tanggalAwal &&
      filter.tanggalAkhir
    ) {
      const days = this.getDaysDifference(
        filter.tanggalAwal,
        filter.tanggalAkhir
      );
      // Suitable if >= 30 days
      return days >= 30;
    }

    // If filter is "bulan_ini", suitable
    if (filter.filterBy === "bulan_ini") {
      return true;
    }

    // If filter is "minggu_ini", check if it spans multiple months
    if (filter.filterBy === "minggu_ini") {
      const dateRange = this.getDateRangeForFilter("minggu_ini");
      if (dateRange) {
        const start = new Date(dateRange.tanggalAwal);
        const end = new Date(dateRange.tanggalAkhir);
        // Check if spans multiple months
        return (
          start.getMonth() !== end.getMonth() ||
          start.getFullYear() !== end.getFullYear()
        );
      }
    }

    return false;
  }

  // Get date range from current filter
  getCurrentFilterDateRange() {
    const filter = this.currentFilter;

    if (
      filter.filterBy === "periode" &&
      filter.tanggalAwal &&
      filter.tanggalAkhir
    ) {
      return {
        tanggalAwal: filter.tanggalAwal,
        tanggalAkhir: filter.tanggalAkhir,
      };
    }

    if (filter.filterBy === "bulan" && filter.bulan) {
      // Parse bulan (format: YYYY-MM)
      const [year, month] = filter.bulan.split("-");
      const firstDay = new Date(year, parseInt(month) - 1, 1);
      const lastDay = new Date(year, parseInt(month), 0);

      return {
        tanggalAwal: `${year}-${String(month).padStart(2, "0")}-01`,
        tanggalAkhir: `${year}-${String(month).padStart(2, "0")}-${String(
          lastDay.getDate()
        ).padStart(2, "0")}`,
      };
    }

    if (filter.filterBy === "tahun" && filter.tahun) {
      return {
        tanggalAwal: `${filter.tahun}-01-01`,
        tanggalAkhir: `${filter.tahun}-12-31`,
      };
    }

    // For "minggu_ini", "bulan_ini", etc., use getDateRangeForFilter
    const dateRange = this.getDateRangeForFilter(filter.filterBy);
    return dateRange || null;
  }

  // Helper: Check if current filter is for today
  isFilteringToday() {
    const today = this.getCurrentDate();
    const currentMonth = this.getCurrentMonth();
    const currentYear = this.getCurrentYear();
    
    // Check filter type
    if (this.currentFilter.filterBy === "hari_ini") {
      return true;
    }
    
    if (this.currentFilter.filterBy === "periode" && 
        this.currentFilter.tanggalAwal && 
        this.currentFilter.tanggalAkhir) {
      // Check if both dates are today
      return this.currentFilter.tanggalAwal === today && 
             this.currentFilter.tanggalAkhir === today;
    }
    
    if (this.currentFilter.filterBy === "bulan" && this.currentFilter.bulan) {
      // Check if it's current month
      return this.currentFilter.bulan === currentMonth;
    }
    
    if (this.currentFilter.filterBy === "tahun" && this.currentFilter.tahun) {
      // Check if it's current year
      return this.currentFilter.tahun === currentYear;
    }
    
    // For other filters (kemarin, minggu_ini, bulan_ini), not today
    return false;
  }

  /**
   * Muat agregat periode aktif plus baris untuk tabel, dalam satu panggilan.
   *
   * Versi lama menarik SELURUH baris periode (`limit: "999999"`), menormalkan
   * puluhan ribu objek Date, menyalinnya ke filteredData, lalu menyerahkannya ke
   * renderer yang menjumlahkan semuanya di browser -- padahal tabelnya cuma
   * menampilkan 100 baris teratas. Sekarang penjumlahan ada di Postgres di atas
   * mv_tx_facts, dan yang dikirim tinggal ringkasannya.
   */
  async loadData() {
    console.time('⏱️ [Dashboard] Total Load Time');
    this.setLoading(true);

    try {
      const range = this.getCurrentFilterDateRange();
      if (!range || !range.tanggalAwal || !range.tanggalAkhir) {
        throw new Error("Rentang tanggal filter tidak valid");
      }

      console.time('⏱️ [Dashboard] API Call - Analytics');
      const analytics = await this.api.getAnalytics({
        tanggalAwal: range.tanggalAwal,
        tanggalAkhir: range.tanggalAkhir,
        rows: 100, // Sama dengan jumlah yang benar-benar dirender renderTable()
      });
      console.timeEnd('⏱️ [Dashboard] API Call - Analytics');

      this.analytics = analytics;
      // Baris tabel sudah dipotong di server; normalizeData hanya menambahkan
      // `dt` dan mengurutkan, biayanya sekarang atas 100 baris, bukan 80.000.
      this.rawData = this.normalizeData(
        // Alias ke nama lama supaya normalizeData dan renderTable tidak perlu
        // tahu bentuk payload endpoint yang baru.
        (analytics?.rows || []).map((row) => ({
          ...row,
          idtransaksi: row.id_transaction,
          waktu_diterima_raw: row.occurred_at,
          total_harga: row.total_amount,
        }))
      );
      this.filteredData = [...this.rawData];

      // Total nota kini datang dari agregat, bukan dari panjang array baris --
      // array itu sengaja dipotong 100, jadi memakai panjangnya akan salah.
      this.setTotalNota(analytics?.kpi?.tx || 0);

      console.log("✅ Data loaded successfully:", {
        transaksi: analytics?.kpi?.tx || 0,
        omzet: analytics?.kpi?.omzet || 0,
        barisTabel: this.rawData.length,
        hariAktif: analytics?.kpi?.hari_aktif || 0,
      });

      return {
        summary: this.summary,
        transactions: this.rawData,
        analytics,
      };
    } catch (error) {
      console.error("❌ Failed to load data:", error);
      this.showError("Gagal memuat data: " + error.message);
      throw error;
    } finally {
      this.setLoading(false);
      console.timeEnd('⏱️ [Dashboard] Total Load Time');
    }
  }

  async loadWeeklyData(useFilter = false) {
    console.time('⏱️ [Dashboard] Load Weekly Data');
    try {
      let tanggalAwal, tanggalAkhir;

      if (useFilter) {
        // STRICT MODE: Always use filter if useFilter is true
        // This satisfies "hari ini ya hari ini aja"
        const dateRange = this.getCurrentFilterDateRange();
        if (dateRange) {
          tanggalAwal = dateRange.tanggalAwal;
          tanggalAkhir = dateRange.tanggalAkhir;
        } else {
          tanggalAwal = this.getWeekStartDate();
          tanggalAkhir = this.getCurrentDate();
        }
      } else {
        tanggalAwal = this.getWeekStartDate();
        tanggalAkhir = this.getCurrentDate();
      }

      // rows: 0 -- grafik mingguan hanya butuh agregat harian, tidak butuh baris.
      this.weeklyAnalytics = await this.api.getAnalytics({
        tanggalAwal,
        tanggalAkhir,
        rows: 0,
      });
      console.log(
        "✅ Weekly analytics loaded:",
        this.weeklyAnalytics?.daily?.length || 0,
        "hari"
      );
    } catch (error) {
      console.error("❌ Failed to load weekly data:", error);
      this.weeklyAnalytics = null;
    } finally {
      console.timeEnd('⏱️ [Dashboard] Load Weekly Data');
    }
  }

  async loadMonthlyData(useFilter = false) {
    console.time('⏱️ [Dashboard] Load Monthly Data');
    try {
      let tanggalAwal, tanggalAkhir;

      if (useFilter) {
        // STRICT MODE: Always use filter if useFilter is true
        const dateRange = this.getCurrentFilterDateRange();
        if (dateRange) {
          tanggalAwal = dateRange.tanggalAwal;
          tanggalAkhir = dateRange.tanggalAkhir;
        } else {
          tanggalAwal = this.getMonthStartDate();
          tanggalAkhir = this.getCurrentDate();
        }
      } else {
        tanggalAwal = this.getMonthStartDate();
        tanggalAkhir = this.getCurrentDate();
      }

      this.monthlyAnalytics = await this.api.getAnalytics({
        tanggalAwal,
        tanggalAkhir,
        rows: 0,
      });
      console.log(
        "✅ Monthly analytics loaded:",
        this.monthlyAnalytics?.daily?.length || 0,
        "hari"
      );
    } catch (error) {
      console.error("❌ Failed to load monthly data:", error);
      this.monthlyAnalytics = null;
    } finally {
      console.timeEnd('⏱️ [Dashboard] Load Monthly Data');
    }
  }

  normalizeData(rawArray) {
    return rawArray
      .map((x) => {
        const iso = x.waktu_diterima_raw || x.waktu_diterima;
        const dt = this.parseDateRaw(iso);
        return { ...x, dt };
      })
      .filter((x) => x.dt)
      .sort((a, b) => new Date(b.dt) - new Date(a.dt)); // Sort by date descending (newest first)
  }

  parseDateRaw(s) {
    // Expect ISO like "2025-10-07T18:36:48+07:00"
    const dt = s ? new Date(s) : null;
    return dt && !isNaN(+dt) ? dt : null;
  }

  buildSummaryParams() {
    const params = {
      filter_by: "periode", // Always use periode for new filters
      limit: "20",
      offset: "0",
    };

    // Handle new filter types
    const dateRange = this.getDateRangeForFilter(this.currentFilter.filterBy);
    if (dateRange) {
      params.tanggal_awal = dateRange.tanggalAwal;
      params.tanggal_akhir = dateRange.tanggalAkhir;
    } else if (
      this.currentFilter.filterBy === "periode" &&
      this.currentFilter.tanggalAwal &&
      this.currentFilter.tanggalAkhir
    ) {
      params.tanggal_awal = this.currentFilter.tanggalAwal;
      params.tanggal_akhir = this.currentFilter.tanggalAkhir;
    } else if (this.currentFilter.filterBy === "bulan") {
      params.filter_by = "bulan";
      params.bulan = this.currentFilter.bulan;
    } else if (this.currentFilter.filterBy === "tahun") {
      // For tahun filter, use periode with full year range to ensure all data is fetched
      const yearRange = this.getCurrentFilterDateRange();
      if (yearRange) {
        params.tanggal_awal = yearRange.tanggalAwal;
        params.tanggal_akhir = yearRange.tanggalAkhir;
      } else {
        // Fallback: construct year range manually
        const year = this.currentFilter.tahun || new Date().getFullYear();
        params.tanggal_awal = `${year}-01-01`;
        params.tanggal_akhir = `${year}-12-31`;
      }
    }

    // Validate: Prevent future dates from being sent to API
    if (params.tanggal_akhir) {
      const today = this.getCurrentDate();
      if (params.tanggal_akhir > today) {
        console.warn(`⚠️ Preventing future end date: ${params.tanggal_akhir}, using today: ${today}`);
        params.tanggal_akhir = today;
      }
    }
    if (params.tanggal_awal && params.tanggal_akhir && params.tanggal_awal > params.tanggal_akhir) {
      console.warn(`⚠️ Start date after end date, swapping: ${params.tanggal_awal} > ${params.tanggal_akhir}`);
      const temp = params.tanggal_awal;
      params.tanggal_awal = params.tanggal_akhir;
      params.tanggal_akhir = temp;
    }

    console.log("📊 Summary params:", params);
    return params;
  }

  buildTransactionParams() {
    const params = {
      filter_by: "periode", // Always use periode for new filters
      offset: "0",
    };

    // Determine limit
    if (this.currentFilter.limit === "max") {
      // Allow dynamic override, but provide a safe fallback if not set yet
      params.limit = "50000"; 
    } else if (this.currentFilter.limit === "custom") {
      params.limit = "100"; // Default custom limit
    } else {
      params.limit = this.currentFilter.limit || "100";
    }

    // Handle new filter types
    const dateRange = this.getDateRangeForFilter(this.currentFilter.filterBy);
    if (dateRange) {
      params.tanggal_awal = dateRange.tanggalAwal;
      params.tanggal_akhir = dateRange.tanggalAkhir;
    } else if (
      this.currentFilter.filterBy === "periode" &&
      this.currentFilter.tanggalAwal &&
      this.currentFilter.tanggalAkhir
    ) {
      params.tanggal_awal = this.currentFilter.tanggalAwal;
      params.tanggal_akhir = this.currentFilter.tanggalAkhir;
    } else if (this.currentFilter.filterBy === "bulan") {
      params.filter_by = "bulan";
      params.bulan = this.currentFilter.bulan;
    } else if (this.currentFilter.filterBy === "tahun") {
      // For tahun filter, use periode with full year range to ensure all data is fetched
      const yearRange = this.getCurrentFilterDateRange();
      if (yearRange) {
        params.tanggal_awal = yearRange.tanggalAwal;
        params.tanggal_akhir = yearRange.tanggalAkhir;
      } else {
        // Fallback: construct year range manually
        const year = this.currentFilter.tahun || new Date().getFullYear();
        params.tanggal_awal = `${year}-01-01`;
        params.tanggal_akhir = `${year}-12-31`;
      }
    }

    // Validate: Prevent future dates from being sent to API
    if (params.tanggal_akhir) {
      const today = this.getCurrentDate();
      if (params.tanggal_akhir > today) {
        console.warn(`⚠️ Preventing future end date: ${params.tanggal_akhir}, using today: ${today}`);
        params.tanggal_akhir = today;
      }
    }
    if (params.tanggal_awal && params.tanggal_akhir && params.tanggal_awal > params.tanggal_akhir) {
      console.warn(`⚠️ Start date after end date, swapping: ${params.tanggal_awal} > ${params.tanggal_akhir}`);
      const temp = params.tanggal_awal;
      params.tanggal_awal = params.tanggal_akhir;
      params.tanggal_akhir = temp;
    }

    console.log("📊 Transaction params:", params);
    return params;
  }

  getTotalNota() {
    // Try to get from current summary first
    if (this.summary?.data?.total_nota) {
      console.log(
        "📊 Getting total_nota from summary:",
        this.summary.data.total_nota
      );
      return this.summary.data.total_nota;
    }

    // Fallback to localStorage
    const stored = localStorage.getItem("smartlink_total_nota");
    console.log("📊 Getting total_nota from localStorage:", stored);
    return stored ? parseInt(stored) : null;
  }

  setTotalNota(totalNota) {
    // Store in localStorage for persistence
    localStorage.setItem("smartlink_total_nota", totalNota.toString());
    console.log("📊 Total nota stored in localStorage:", totalNota);
  }

  updateFilter(newFilter) {
    const oldFilter = { ...this.currentFilter };
    this.currentFilter = { ...this.currentFilter, ...newFilter };

    // Clear localStorage if filter type changed to avoid stale data
    if (oldFilter.filterBy !== newFilter.filterBy) {
      console.log("🔄 Filter type changed, clearing localStorage");
      localStorage.removeItem("smartlink_total_nota");
    }

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

    // Also handle existing loading class elements
    const elements = document.querySelectorAll(".loading");
    elements.forEach((el) => {
      if (loading) {
        el.classList.add("loading");
      } else {
        el.classList.remove("loading");
      }
    });
  }

  showError(message) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "error-message";
    errorDiv.textContent = message;

    const container = document.querySelector("main");
    const firstSection = container.querySelector("section");
    container.insertBefore(errorDiv, firstSection);

    // Auto remove after 5 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 5000);
  }

  showSuccess(message) {
    const successDiv = document.createElement("div");
    successDiv.className = "success-message";
    successDiv.textContent = message;

    const container = document.querySelector("main");
    const firstSection = container.querySelector("section");
    container.insertBefore(successDiv, firstSection);

    // Auto remove after 3 seconds
    setTimeout(() => {
      if (successDiv.parentNode) {
        successDiv.parentNode.removeChild(successDiv);
      }
    }, 3000);
  }

  getFilterDescription() {
    const dateRange = this.getDateRangeForFilter(this.currentFilter.filterBy);

    if (this.currentFilter.filterBy === "hari_ini") {
      return "Hari Ini";
    } else if (this.currentFilter.filterBy === "kemarin") {
      return "Kemarin";
    } else if (this.currentFilter.filterBy === "minggu_ini") {
      return "Minggu Ini";
    } else if (this.currentFilter.filterBy === "bulan_ini") {
      return "Bulan Ini";
    } else if (this.currentFilter.filterBy === "periode") {
      if (this.currentFilter.tanggalAwal && this.currentFilter.tanggalAkhir) {
        const startDate = new Date(this.currentFilter.tanggalAwal);
        const endDate = new Date(this.currentFilter.tanggalAkhir);
        
        // Calculate duration
        const diffTime = endDate - startDate;
        let durationStr = "";
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

        return `Periode ${startDate.toLocaleDateString(
          "id-ID"
        )} - ${endDate.toLocaleDateString("id-ID")}${durationStr}`;
      }
      return "Periode tertentu";
    } else if (this.currentFilter.filterBy === "bulan") {
      const [year, month] = this.currentFilter.bulan.split("-");
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
      return `Bulan ${monthNames[parseInt(month) - 1]} ${year}`;
    } else if (this.currentFilter.filterBy === "tahun") {
      return `Tahun ${this.currentFilter.tahun}`;
    }

    return "Filter tidak dikenal";
  }

  /**
   * Unduh export dari server: satu ZIP berisi 5 CSV.
   *
   * Menggantikan exportExcel() lama, yang lebih dulu memanggil
   * /api/transactions/batch-details untuk SETIAP id transaksi pada periode
   * (80k id dalam satu POST: mget Redis + WHERE id = ANY($1) + parse jsonb di
   * dalam request path), lalu menyusun lima lembar xlsx di browser. Itu sumber
   * "nunggu proses"-nya, bukan penulisan filenya.
   *
   * Sekarang kolom mesin dan nama layanan sudah dipipihkan di mv_tx_facts saat
   * refresh harian, jadi server tinggal menuang isinya. Tidak ada enrichment,
   * tidak ada antrean, tidak ada file yang di-generate lebih dulu.
   */
  async downloadExport(abortSignal = null) {
    const range = this.getCurrentFilterDateRange();
    if (!range || !range.tanggalAwal || !range.tanggalAkhir) {
      throw new Error("Rentang tanggal tidak valid untuk export");
    }

    const params = new URLSearchParams({
      tanggal_awal: range.tanggalAwal,
      tanggal_akhir: range.tanggalAkhir,
    });

    const response = await fetch(
      `${this.api.apiBase}/api/transactions/export?${params}`,
      { headers: Auth.getAuthHeaders(), signal: abortSignal }
    );

    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.message || body?.error || "";
      } catch (_) {
        // Respons non-JSON: pesan status saja sudah cukup.
      }
      throw new Error(
        `Export gagal (${response.status})${detail ? `: ${detail}` : ""}`
      );
    }

    // Nama file datang dari Content-Disposition supaya penamaan hanya ada di
    // satu tempat, di server, dan tidak ikut menyimpang kalau formatnya diubah.
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename =
      (match && match[1]) ||
      `Transaksi_${range.tanggalAwal}_sd_${range.tanggalAkhir}.zip`;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Objek URL menahan blob di memori sampai dilepas; 8 MB tidak besar, tapi
    // beberapa export berturut-turut tanpa ini akan menumpuk.
    URL.revokeObjectURL(url);

    return {
      filename,
      rows: Number(response.headers.get("X-Export-Rows") || 0),
      durationMs: Number(response.headers.get("X-Export-Duration-Ms") || 0),
      coveredThrough: response.headers.get("X-Mv-Covered-Through"),
      size: blob.size,
    };
  }
}

// Dashboard Renderer
class DashboardRenderer {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.charts = {};
    this.IDR = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    });
    this.DTF = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });
  }

  render(data) {
    this.renderKPIs(data);
    this.renderCharts(data);
    this.renderTable(data.transactions);
    this.renderDataRangeInfo();
  }

  renderKPIs(data) {
    const stats = this.computeStats(data.analytics);
    const kpi = data.analytics?.kpi || {};

    document.getElementById("kpi-revenue").textContent = this.IDR.format(
      stats.rev
    );
    document.getElementById("kpi-aov").textContent = `AOV ${this.IDR.format(
      stats.aov
    )}`;
    document.getElementById("kpi-tx").textContent =
      stats.tx.toLocaleString("id-ID");

    // Rentang tanggal datang dari agregat server (min/max atas SELURUH periode),
    // bukan dari baris yang kebetulan terkirim. Versi lama menghitungnya dari
    // array transaksi, yang kini hanya berisi 100 baris teratas -- membacanya
    // dari situ akan menampilkan rentang yang jauh lebih sempit dari kenyataan.
    let rangeTxt = "Semua data";
    if (kpi.dari && kpi.sampai) {
      const toLocal = (iso) => {
        const [y, m, d] = String(iso).split("-").map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
      };
      rangeTxt = `${this.DTF.format(toLocal(kpi.dari))} – ${this.DTF.format(
        toLocal(kpi.sampai)
      )}`;
    }
    document.getElementById("kpi-date-range").textContent = rangeTxt;

    // Mesin teraktif. Menggantikan Paid Rate, yang bersumber dari
    // transaction_details.status_lunas -- tabel yang tidak lagi dibaca. Untuk
    // laundry prabayar nilainya praktis selalu 1, jadi KPI-nya macet di 100%.
    const topMachine = (data.analytics?.machines || [])[0];
    document.getElementById("kpi-top-machine").textContent = topMachine
      ? topMachine.machine_label || topMachine.machine_id
      : "–";
    document.getElementById("kpi-top-machine-sub").textContent = topMachine
      ? `${topMachine.tx.toLocaleString("id-ID")} transaksi · ${this.IDR.format(
          topMachine.omzet
        )}`
      : "–";

    // Per day
    document.getElementById("kpi-perday").textContent = this.IDR.format(
      stats.perday
    );
    document.getElementById("kpi-growth").textContent = stats.growthText;
  }

  renderDataRangeInfo() {
    const infoDiv = document.getElementById("data-range-info");
    if (infoDiv) {
      const description = this.dataManager.getFilterDescription();
      infoDiv.innerHTML = `
        <div class="range-text">${description}</div>
        <div class="range-dates">Data terakhir diperbarui: ${new Date().toLocaleString(
          "id-ID"
        )}</div>
      `;
    }
  }

  /**
   * Bentuk statistik untuk seluruh renderer grafik, dari payload
   * /api/transactions/analytics.
   *
   * Dulu fungsi ini menerima array baris mentah dan mengagregasi 80k di antaranya
   * di browser -- padahal renderTable() cuma memakai 100 baris teratas, sisanya
   * ditarik lewat jaringan hanya untuk dijumlahkan lalu dibuang. Sekarang
   * penjumlahannya di Postgres, dan yang tersisa di sini hanya pembentukan
   * label: pengelompokan minggu/bulan dan matriks heatmap.
   *
   * Susunan objek yang dikembalikan SENGAJA dipertahankan persis seperti versi
   * lama (byDay, byWeek, byMonth, byHour, bucketCounts, heat, days, ...) supaya
   * tidak ada satu pun renderChart* yang perlu diubah.
   */
  computeStats(analytics) {
    const kpi = analytics?.kpi || {};
    const tx = Number(kpi.tx || 0);
    const rev = Number(kpi.omzet || 0);
    const aov = Number(kpi.aov || 0);
    const byDay = (analytics?.daily || []).map((d) => ({
      date: d.tanggal,
      rev: Number(d.omzet || 0),
      tx: Number(d.tx || 0),
    }));

    // Growth
    let growthText = "–";
    if (byDay.length >= 2) {
      const last = byDay[byDay.length - 1];
      const prev = byDay[byDay.length - 2];
      const gr = prev.rev ? ((last.rev - prev.rev) / prev.rev) * 100 : 0;
      growthText = `${gr >= 0 ? "▲" : "▼"} ${Math.abs(gr).toFixed(
        1
      )}% vs hari sebelumnya`;
    }

    const perday = Number(kpi.omzet_per_hari || 0);

    // Hourly
    const byHour = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      tx: 0,
      rev: 0,
    }));
    (analytics?.hourly || []).forEach((h) => {
      const idx = Number(h.jam);
      if (idx >= 0 && idx < 24) {
        byHour[idx].tx = Number(h.tx || 0);
        byHour[idx].rev = Number(h.omzet || 0);
      }
    });

    // Ticket buckets — ambang batasnya kini di SQL, urutannya dipertahankan.
    const bucketCounts =
      analytics?.buckets && analytics.buckets.length
        ? analytics.buckets.map((b) => ({
            label: b.label,
            count: Number(b.count || 0),
          }))
        : [
            { label: "<= 5k", count: 0 },
            { label: "5k–10k", count: 0 },
            { label: "10k–15k", count: 0 },
            { label: "> 15k", count: 0 },
          ];

    // Heat map
    const days = [
      "Minggu",
      "Senin",
      "Selasa",
      "Rabu",
      "Kamis",
      "Jumat",
      "Sabtu",
    ];
    const heat = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => 0)
    );
    (analytics?.heat || []).forEach((cell) => {
      const dow = Number(cell.dow);
      const jam = Number(cell.jam);
      if (dow >= 0 && dow < 7 && jam >= 0 && jam < 24) {
        heat[dow][jam] = Number(cell.tx || 0);
      }
    });

    // "YYYY-MM-DD" diurai manual, bukan lewat new Date(string): bentuk itu
    // ditafsirkan sebagai UTC dan menggeser tanggal satu hari di WIB.
    const parseLocalDate = (iso) => {
      const [y, m, d] = String(iso).split("-").map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    };

    // Weekly aggregation
    // When filtering by month, use month-based weeks (1-7, 8-14, etc.) instead of ISO weeks
    // This prevents cross-month labels like "29 Des - 04 Jan"
    const byWeekMap = new Map();
    const currentFilter = this.dataManager?.currentFilter;
    const filterMonth = currentFilter?.bulan ? parseInt(currentFilter.bulan.split('-')[1]) : null;
    const filterYear = currentFilter?.bulan ? parseInt(currentFilter.bulan.split('-')[0]) : null;
    const useMonthBasedWeeks = filterMonth && filterYear; // Use month-based weeks when filtering by month

    byDay.forEach((point) => {
      const date = parseLocalDate(point.date);

      let weekStart, weekKey, weekLabel;

      if (useMonthBasedWeeks) {
        // Month-based weeks: group by week within the month (1-7, 8-14, 15-21, 22-28, 29+)
        const transactionMonth = date.getMonth() + 1;
        const transactionYear = date.getFullYear();

        // Only include transactions from the filtered month
        if (transactionMonth !== filterMonth || transactionYear !== filterYear) {
          return; // Skip transactions outside filtered month
        }

        // Calculate week number within month (1-based)
        const dayOfMonth = date.getDate();
        const weekOfMonth = Math.ceil(dayOfMonth / 7);

        // Week start is the first day of this week within the month
        const weekStartDay = (weekOfMonth - 1) * 7 + 1;
        weekStart = new Date(transactionYear, transactionMonth - 1, weekStartDay);
        weekKey = `${transactionYear}-${String(transactionMonth).padStart(2, '0')}-W${weekOfMonth}`;

        // Calculate week end day (last day of this week or last day of month, whichever is earlier)
        const weekEndDay = Math.min(weekStartDay + 6, new Date(transactionYear, transactionMonth, 0).getDate());

        // Format: "1-7 Jan" or "8-14 Jan"
        const monthName = weekStart.toLocaleDateString('id-ID', { month: 'short' });
        const customLabel = `${weekStartDay}-${weekEndDay} ${monthName}`;

        weekLabel = `Minggu ke ${weekOfMonth} (${customLabel})`;
      } else {
        // ISO weeks: use standard Monday-based weeks
        weekStart = this.getWeekStart(date);
        weekKey = weekStart.toISOString().slice(0, 10);
        weekLabel = this.getWeekLabel(weekStart);
      }

      const cur = byWeekMap.get(weekKey) || {
        date: weekKey,
        rev: 0,
        tx: 0,
        weekLabel: weekLabel,
        weekStart: weekStart, // Store weekStart for filtering
      };
      cur.rev += point.rev;
      cur.tx += point.tx;
      byWeekMap.set(weekKey, cur);
    });

    const byWeek = Array.from(byWeekMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Monthly aggregation
    const byMonthMap = new Map();
    byDay.forEach((point) => {
      const date = parseLocalDate(point.date);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const monthLabel = date.toLocaleDateString("id-ID", {
        year: "numeric",
        month: "long",
      });

      const cur = byMonthMap.get(monthKey) || {
        date: monthKey,
        rev: 0,
        tx: 0,
        monthLabel: monthLabel,
      };
      cur.rev += point.rev;
      cur.tx += point.tx;
      byMonthMap.set(monthKey, cur);
    });
    const byMonth = Array.from(byMonthMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    return {
      tx,
      rev,
      aov,
      byDay,
      byWeek,
      byMonth,
      byHour,
      bucketCounts,
      perday,
      growthText,
      heat,
      days,
    };
  }

  renderLoading() {
    // Show skeleton/loading state for KPIs
    const kpiIds = ["kpi-revenue", "kpi-tx", "kpi-aov", "kpi-top-machine", "kpi-top-machine-sub", "kpi-perday", "kpi-growth"];
    kpiIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="h-6 w-24 bg-slate-200 animate-pulse rounded"></div>';
    });

    // Show loading state for charts
    const chartIds = [
      "chartDaily", "chartTicket", "chartWeekly",
      "chartTransactionDaily", "chartTransactionWeekly", "chartTransactionMonthly",
      "chartMonthlyRevenue", "chartCombined", "chartHourly"
    ];

    chartIds.forEach(id => {
      // Check if chart instance exists
      if (this.charts[id]) {
        this.charts[id].destroy();
        delete this.charts[id];
      }
      
      const ctx = document.getElementById(id);
      if (ctx) {
         const parent = ctx.parentElement;
         // Add loading overlay if not exists
         if (!parent.querySelector('.chart-loading-overlay')) {
             const overlay = document.createElement('div');
             overlay.className = 'chart-loading-overlay absolute inset-0 flex items-center justify-content-center bg-white/50 backdrop-blur-sm z-10';
             overlay.innerHTML = '<div class="flex flex-col items-center"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div><span class="text-sm text-slate-500">Menghitung data...</span></div>';
             parent.style.position = 'relative'; // Ensure parent has positioning
             parent.appendChild(overlay);
         }
      }
    });

    // Clear table body
    const tableBody = document.getElementById("txBody");
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center p-8 text-slate-500">Memuat data transaksi...</td></tr>';
    }
    
    // Clear heat map
    const heatWrap = document.getElementById("heatWrap");
    if (heatWrap) {
        heatWrap.innerHTML = '<div class="flex items-center justify-center h-48 text-slate-400">Memuat Heat Map...</div>';
    }
  }

  renderCharts(data) {
    const stats = this.computeStats(data.analytics);

    // Use main data for daily charts
    this.renderDailyChart(stats);
    this.renderCombinedChart(stats);
    this.renderHourlyChart(stats);
    this.renderHeatMap(stats);
    this.renderTransactionDailyChart(stats);

    // Use weekly data for weekly charts (always shows current week)
    const weeklyStats = this.computeStats(this.dataManager.weeklyAnalytics);
    this.renderWeeklyChart(weeklyStats);
    this.renderTransactionWeeklyChart(weeklyStats);

    // Use monthly data for monthly charts (always shows current month)
    const monthlyStats = this.computeStats(this.dataManager.monthlyAnalytics);
    this.renderMonthlyRevenueChart(monthlyStats);
    this.renderTransactionMonthlyChart(monthlyStats);
  }

  renderDailyChart(stats) {
    this.makeChart("chartDaily", {
      type: "line",
      data: {
        labels: stats.byDay.map((d) => d.date),
        datasets: [
          {
            label: "Omzet (IDR)",
            data: stats.byDay.map((d) => d.rev),
            borderWidth: 3,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "rgba(14,165,233,1)",
            pointBorderColor: "rgba(14,165,233,1)",
            pointBorderWidth: 2,
            borderColor: "rgba(14,165,233,1)",
            backgroundColor: "rgba(14,165,233,0.12)",
            fill: true,
          },
        ],
      },
      options: {
        scales: {
          y: {
            ticks: { callback: (v) => this.IDR.format(v) },
            beginAtZero: true,
          },
          x: {
            ticks: {
              callback: (v, i, t) => {
                const date = new Date(stats.byDay[i].date);
                const isWeekend = this.isWeekend(date);
                return this.shortDate(date);
              },
              color: (ctx) => {
                const date = new Date(stats.byDay[ctx.index].date);
                return this.isWeekend(date) ? "#dc2626" : "#6b7280";
              },
              font: {
                weight: (ctx) => {
                  const date = new Date(stats.byDay[ctx.index].date);
                  return this.isWeekend(date) ? "bold" : "normal";
                },
              },
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const date = new Date(stats.byDay[ctx.dataIndex].date);
                const dateStr = date.toLocaleDateString("id-ID", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                });
                return `${dateStr}: ${this.IDR.format(ctx.raw)}`;
              },
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    });
  }

  renderTicketChart(stats) {
    this.makeChart("chartTicket", {
      type: "doughnut",
      data: {
        labels: stats.bucketCounts.map((b) => b.label),
        datasets: [
          {
            data: stats.bucketCounts.map((b) => b.count),
            borderWidth: 0,
          },
        ],
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        cutout: "62%",
      },
    });
  }

  renderWeeklyChart(stats) {
    this.makeChart("chartWeekly", {
      type: "bar",
      data: {
        labels: stats.byWeek.map((w) => w.weekLabel),
        datasets: [
          {
            label: "Omzet per Minggu (IDR)",
            data: stats.byWeek.map((w) => w.rev),
            backgroundColor: "rgba(14,165,233,0.8)",
            borderColor: "rgba(14,165,233,1)",
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        scales: {
          y: {
            ticks: { callback: (v) => this.IDR.format(v) },
            beginAtZero: true,
          },
          x: {
            ticks: {
              maxRotation: 0,
              minRotation: 0,
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const week = stats.byWeek[ctx.dataIndex];
                return `Minggu ${week.weekLabel}: ${this.IDR.format(ctx.raw)}`;
              },
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    });
  }

  renderTransactionDailyChart(stats) {
    this.makeChart("chartTransactionDaily", {
      type: "line",
      data: {
        labels: stats.byDay.map((d) => d.date),
        datasets: [
          {
            label: "Jumlah Transaksi",
            data: stats.byDay.map((d) => d.tx),
            borderWidth: 3,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "rgba(252,211,77,1)",
            pointBorderColor: "rgba(252,211,77,1)",
            pointBorderWidth: 2,
            borderColor: "rgba(252,211,77,1)",
            backgroundColor: "rgba(252,211,77,0.12)",
            fill: true,
          },
        ],
      },
      options: {
        scales: {
          y: {
            ticks: { callback: (v) => v.toLocaleString("id-ID") },
            beginAtZero: true,
          },
          x: {
            ticks: {
              callback: (v, i, t) => {
                const date = new Date(stats.byDay[i].date);
                const isWeekend = this.isWeekend(date);
                return this.shortDate(date);
              },
              color: (ctx) => {
                const date = new Date(stats.byDay[ctx.index].date);
                return this.isWeekend(date) ? "#dc2626" : "#6b7280";
              },
              font: {
                weight: (ctx) => {
                  const date = new Date(stats.byDay[ctx.index].date);
                  return this.isWeekend(date) ? "bold" : "normal";
                },
              },
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const date = new Date(stats.byDay[ctx.dataIndex].date);
                const dateStr = date.toLocaleDateString("id-ID", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                });
                return `${dateStr}: ${ctx.raw} transaksi`;
              },
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    });
  }

  renderTransactionWeeklyChart(stats) {
    this.makeChart("chartTransactionWeekly", {
      type: "line",
      data: {
        labels: stats.byWeek.map((w) => w.weekLabel),
        datasets: [
          {
            label: "Jumlah Transaksi",
            data: stats.byWeek.map((w) => w.tx),
            borderWidth: 3,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "rgba(252,211,77,1)",
            pointBorderColor: "rgba(252,211,77,1)",
            pointBorderWidth: 2,
            borderColor: "rgba(252,211,77,1)",
            backgroundColor: "rgba(252,211,77,0.12)",
            fill: true,
          },
        ],
      },
      options: {
        scales: {
          y: {
            ticks: { callback: (v) => v.toLocaleString("id-ID") },
            beginAtZero: true,
          },
          x: {
            ticks: {
              maxRotation: 0,
              minRotation: 0,
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const week = stats.byWeek[ctx.dataIndex];
                return `${week.weekLabel}: ${ctx.raw} transaksi`;
              },
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    });
  }

  renderTransactionMonthlyChart(stats) {
    this.makeChart("chartTransactionMonthly", {
      type: "bar",
      data: {
        labels: stats.byMonth.map((m) => m.monthLabel),
        datasets: [
          {
            label: "Jumlah Transaksi",
            data: stats.byMonth.map((m) => m.tx),
            backgroundColor: "rgba(252,211,77,0.8)",
            borderColor: "rgba(252,211,77,1)",
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        scales: {
          y: {
            ticks: { callback: (v) => v.toLocaleString("id-ID") },
            beginAtZero: true,
          },
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 45,
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const month = stats.byMonth[ctx.dataIndex];
                return `${month.monthLabel}: ${ctx.raw} transaksi`;
              },
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    });
  }

  renderMonthlyRevenueChart(stats) {
    this.makeChart("chartMonthlyRevenue", {
      type: "bar",
      data: {
        labels: stats.byMonth.map((m) => m.monthLabel),
        datasets: [
          {
            label: "Omzet per Bulan (IDR)",
            data: stats.byMonth.map((m) => m.rev),
            backgroundColor: "rgba(14,165,233,0.8)",
            borderColor: "rgba(14,165,233,1)",
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        scales: {
          y: {
            ticks: { callback: (v) => this.IDR.format(v) },
            beginAtZero: true,
          },
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 45,
            },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const month = stats.byMonth[ctx.dataIndex];
                return `${month.monthLabel}: ${this.IDR.format(ctx.raw)}`;
              },
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    });
  }

  renderCombinedChart(stats) {
    this.makeChart("chartCombined", {
      type: "line",
      data: {
        labels: stats.byDay.map((d) => d.date),
        datasets: [
          {
            label: "Omzet (IDR)",
            data: stats.byDay.map((d) => d.rev),
            borderWidth: 3,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "rgba(14,165,233,1)",
            pointBorderColor: "rgba(14,165,233,1)",
            pointBorderWidth: 2,
            borderColor: "rgba(14,165,233,1)",
            backgroundColor: "rgba(14,165,233,0.12)",
            fill: false,
            yAxisID: "y",
          },
          {
            label: "Jumlah Transaksi",
            data: stats.byDay.map((d) => d.tx),
            borderWidth: 3,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "rgba(252,211,77,1)",
            pointBorderColor: "rgba(252,211,77,1)",
            pointBorderWidth: 2,
            borderColor: "rgba(252,211,77,1)",
            backgroundColor: "rgba(252,211,77,0.12)",
            fill: false,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        scales: {
          y: {
            type: "linear",
            display: true,
            position: "left",
            ticks: {
              callback: (v) => this.IDR.format(v),
              color: "rgba(14,165,233,1)",
            },
            beginAtZero: true,
            grid: {
              color: "rgba(14,165,233,0.1)",
            },
          },
          y1: {
            type: "linear",
            display: true,
            position: "right",
            ticks: {
              callback: (v) => v.toLocaleString("id-ID"),
              color: "rgba(252,211,77,1)",
            },
            beginAtZero: true,
            grid: {
              drawOnChartArea: false,
            },
          },
          x: {
            ticks: {
              callback: (v, i, t) => {
                const date = new Date(stats.byDay[i].date);
                const isWeekend = this.isWeekend(date);
                return this.shortDate(date);
              },
              color: (ctx) => {
                const date = new Date(stats.byDay[ctx.index].date);
                return this.isWeekend(date) ? "#dc2626" : "#6b7280";
              },
              font: {
                weight: (ctx) => {
                  const date = new Date(stats.byDay[ctx.index].date);
                  return this.isWeekend(date) ? "bold" : "normal";
                },
              },
            },
          },
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              usePointStyle: true,
              padding: 20,
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const date = new Date(stats.byDay[ctx.dataIndex].date);
                const dateStr = date.toLocaleDateString("id-ID", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                });

                if (ctx.datasetIndex === 0) {
                  return `${dateStr} - Omzet: ${this.IDR.format(ctx.raw)}`;
                } else {
                  return `${dateStr} - Transaksi: ${ctx.raw} transaksi`;
                }
              },
            },
          },
        },
        interaction: {
          intersect: false,
          mode: "index",
        },
      },
    });
  }

  renderHourlyChart(stats) {
    this.makeChart("chartHourly", {
      type: "bar",
      data: {
        labels: stats.byHour.map((h) => this.pad2(h.hour)),
        datasets: [
          {
            label: "Tx",
            data: stats.byHour.map((h) => h.tx),
          },
        ],
      },
      options: {
        scales: { y: { beginAtZero: true } },
        plugins: { legend: { display: false } },
      },
    });
  }

  renderHeatMap(stats) {
    const container = document.getElementById("heatWrap");
    const max = Math.max(1, ...stats.heat.flat());
    const scale = (v) => {
      const t = v / max;
      const c = Math.round(255 - 155 * t);
      return `background: rgb(${c}, ${255 - Math.round(120 * t)}, ${255});`;
    };
    const hdr =
      '<tr><th class="text-left p-3 text-sm text-slate-500 font-semibold">Hari/Jam</th>' +
      Array.from(
        { length: 24 },
        (_, h) =>
          `<th class="text-sm text-slate-500 font-semibold p-2">${this.pad2(
            h
          )}</th>`
      ).join("") +
      "</tr>";
    const rows = stats.days
      .map((d, idx) => {
        const cells = stats.heat[idx]
          .map(
            (v) =>
              `<td class="p-2 text-sm font-medium text-center" style="${scale(
                v
              )}">${v || ""}</td>`
          )
          .join("");
        return `<tr><td class="p-3 text-sm text-slate-600 font-semibold">${d}</td>${cells}</tr>`;
      })
      .join("");

    container.innerHTML = `<table class="table heat w-full">${hdr}${rows}</table>`;
  }

  renderTable(rows) {
    const body = document.getElementById("txBody");
    body.innerHTML = rows
      .slice(0, 100) // Ambil 100 data terbaru (sudah terurut dari API)
      .map((r) => {
        const time = r.dt ? new Date(r.dt) : null;
        const d = time ? time.toLocaleDateString("id-ID") : "-";
        const h = time
          ? this.pad2(time.getHours()) + ":" + this.pad2(time.getMinutes())
          : "-";
        // Kolom Jenis/Customer/Paid/Selesai dicabut bersama transaction_details;
        // dua yang pertama memang sudah selalu kosong. Mesin menggantikannya --
        // machine_id sudah ada di `transactions` sejak awal, dan gateway
        // mengirim labelnya ("D05") supaya tidak perlu peta id di sini.
        return `<tr>
        <td>${d}</td>
        <td>${h}</td>
        <td class="font-mono text-xs">${r.idtransaksi || "-"}</td>
        <td>${r.machine_label || r.machine_id || "–"}</td>
        <td>${r.outlet_name || "–"}</td>
        <td class="text-right font-semibold">${this.IDR.format(
          r.total_harga || 0
        )}</td>
      </tr>`;
      })
      .join("");
  }

  makeChart(ctxId, cfg) {
    if (this.charts[ctxId]) {
      this.charts[ctxId].destroy();
    }
    const ctx = document.getElementById(ctxId);
    
    // Remove loading overlay if exists
    if (ctx) {
      const parent = ctx.parentElement;
      const overlay = parent.querySelector('.chart-loading-overlay');
      if (overlay) {
        overlay.remove();
      }
    }

    this.charts[ctxId] = new Chart(ctx, cfg);
  }

  shortDate(d) {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
    }).format(d);
  }

  formatDateShort(d) {
    const day = String(d.getDate()).padStart(2, "0");
    const month = d.toLocaleDateString("id-ID", { month: "short" });
    return `${day} ${month}`;
  }

  pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
    return new Date(d.getFullYear(), d.getMonth(), diff);
  }

  getWeekLabel(weekStart) {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);

    // Calculate week number in the month (weeks starting from Monday)
    // Get the first Monday of the month
    const year = weekStart.getFullYear();
    const month = weekStart.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthStartDay = monthStart.getDay(); // 0 = Sunday, 1 = Monday, etc.

    // Find first Monday of the month
    // If month starts on Sunday (0), first Monday is day 1
    // If month starts on Monday (1), first Monday is day 1
    // If month starts on Tuesday (2), first Monday is day 7 (1 + 6)
    // Formula: (8 - day) % 7 gives days to add, but we need to handle Sunday specially
    let daysToFirstMonday;
    if (monthStartDay === 0) {
      daysToFirstMonday = 1; // Sunday -> Monday is next day
    } else if (monthStartDay === 1) {
      daysToFirstMonday = 0; // Already Monday
    } else {
      daysToFirstMonday = 8 - monthStartDay; // Days until next Monday
    }

    const firstMonday = new Date(year, month, 1 + daysToFirstMonday);

    // Calculate week number in the month
    const daysDiff = Math.floor(
      (weekStart - firstMonday) / (7 * 24 * 60 * 60 * 1000)
    );
    const weekNumber = daysDiff + 1;

    // Format: "Minggu ke X (tanggal - tanggal)" using date format
    return `Minggu ke ${weekNumber} (${this.formatDateShort(
      weekStart
    )} - ${this.formatDateShort(end)})`;
  }

  isWeekend(date) {
    const day = new Date(date).getDay();
    return day === 0 || day === 6; // Sunday or Saturday
  }
}

// Dashboard Controller
class DashboardController {
  constructor() {
    this.dataManager = new DashboardDataManager();
    this.renderer = new DashboardRenderer(this.dataManager);
    this.initializeEventListeners();
    this.initializeFilters();
  }

  initializeEventListeners() {
    // Refresh button
    document.getElementById("refreshData").addEventListener("click", () => {
      this.refreshData();
    });

    // Export Excel button
    const exportBtn = document.getElementById("exportExcel");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        this.exportToExcel();
      });
    }

    // Filter controls
    document.getElementById("filterBy").addEventListener("change", (e) => {
      this.updateFilterType(e.target.value);
    });

    document.getElementById("applyFilter").addEventListener("click", () => {
      this.applyFilter();
    });

    document.getElementById("clearFilter").addEventListener("click", () => {
      this.clearFilter();
    });

    // Limit controls
    document.getElementById("limitType").addEventListener("change", (e) => {
      this.updateLimitType(e.target.value);
    });
  }

  initializeFilters() {
    // Set default values
    const currentMonth = this.dataManager.getCurrentMonth();
    const currentYear = this.dataManager.getCurrentYear();
    const defaultStartDate = this.dataManager.getDefaultStartDate();
    const currentDate = this.dataManager.getCurrentDate();

    document.getElementById("filterBy").value = "hari_ini";
    document.getElementById("bulan").value = currentMonth;
    document.getElementById("tahun").value = currentYear;
    document.getElementById("tanggalAwal").value = defaultStartDate;
    document.getElementById("tanggalAkhir").value = currentDate;

    // Initialize filter type display
    this.updateFilterType("hari_ini");

    // Update filter in dataManager to match UI
    const defaultFilter = {
      filterBy: "hari_ini",
      bulan: currentMonth,
      tahun: currentYear,
      tanggalAwal: currentDate,
      tanggalAkhir: currentDate,
      limit: "max",
    };
    this.dataManager.updateFilter(defaultFilter);
  }

  updateFilterType(type) {
    const bulanGroup = document.getElementById("bulanGroup");
    const tahunGroup = document.getElementById("tahunGroup");
    const periodeGroup = document.getElementById("periodeGroup");
    const periodeGroup2 = document.getElementById("periodeGroup2");

    // Hide all groups
    bulanGroup.style.display = "none";
    tahunGroup.style.display = "none";
    periodeGroup.style.display = "none";
    periodeGroup2.style.display = "none";

    // Show relevant group
    if (type === "bulan") {
      bulanGroup.style.display = "block";
    } else if (type === "tahun") {
      tahunGroup.style.display = "block";
    } else if (type === "periode") {
      periodeGroup.style.display = "block";
      periodeGroup2.style.display = "block";
    }
    // For new filter types (hari_ini, minggu_ini, bulan_ini), no additional inputs needed
  }

  updateLimitType(type) {
    const customLimitGroup = document.getElementById("customLimitGroup");
    if (type === "custom") {
      customLimitGroup.style.display = "block";
    } else {
      customLimitGroup.style.display = "none";
    }
  }

  applyFilter() {
    const filterBy = document.getElementById("filterBy").value;
    const bulan = document.getElementById("bulan").value;
    const tahun = document.getElementById("tahun").value;
    const tanggalAwal = document.getElementById("tanggalAwal").value;
    const tanggalAkhir = document.getElementById("tanggalAkhir").value;
    const limitType = document.getElementById("limitType").value;
    const customLimit = document.getElementById("customLimit").value;

    const newFilter = {
      filterBy,
      bulan,
      tahun,
      tanggalAwal,
      tanggalAkhir,
      limit: limitType === "custom" ? customLimit : limitType,
    };

    this.dataManager.updateFilter(newFilter);
    this.refreshData();
  }

  clearFilter() {
    // Reset to default values
    const currentDate = this.dataManager.getCurrentDate();
    document.getElementById("filterBy").value = "hari_ini";
    document.getElementById("bulan").value = this.dataManager.getCurrentMonth();
    document.getElementById("tahun").value = this.dataManager.getCurrentYear();
    document.getElementById("tanggalAwal").value = currentDate;
    document.getElementById("tanggalAkhir").value = currentDate;
    document.getElementById("limitType").value = "max";
    document.getElementById("customLimit").value = "100";

    this.updateFilterType("hari_ini");
    this.updateLimitType("max");

    const defaultFilter = {
      filterBy: "hari_ini",
      bulan: this.dataManager.getCurrentMonth(),
      tahun: this.dataManager.getCurrentYear(),
      tanggalAwal: currentDate,
      tanggalAkhir: currentDate,
      limit: "max",
    };

    this.dataManager.updateFilter(defaultFilter);
    this.refreshData();
  }

  async refreshData() {
    try {
      this.renderer.renderLoading();
      this.dataManager.showSuccess("Memuat data terbaru...");

      // 1. Fetch Main Data (Priority)
      // Since we are in STRICT MODE ("Hari Ini" = "Hari Ini Only"), 
      // the data for Weekly Chart and Monthly Chart IS THE SAME as the Main Data.
      // We can reuse it entirely and avoid 4 redundant API calls.
      
      console.log("🚀 Fetching data (Strict Mode Reuse)...");
      
      const mainData = await this.dataManager.loadData()
        .catch(err => {
          console.error("❌ Main data failed:", err);
          throw err;
        });

      // 2. Reuse data for secondary contexts
      // STRICT MODE: periode grafik mingguan/bulanan sama dengan periode utama,
      // jadi agregatnya dipakai ulang alih-alih memanggil endpoint dua kali.
      console.log("♻️ Reusing main analytics for strict weekly/monthly context");
      this.dataManager.weeklyAnalytics = mainData.analytics;
      this.dataManager.monthlyAnalytics = mainData.analytics;

      // 3. Render Everything
      console.log("🎨 Rendering all views...");
      this.renderer.render(mainData);
      
      // Update loading status
      this.dataManager.showSuccess("Data berhasil diperbarui!");
    } catch (error) {
      console.error("Failed to refresh data:", error);

      // Show user-friendly error message
      let errorMessage = "Gagal memuat data. Silakan coba lagi.";
      if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
        errorMessage =
          "Waktu tunggu habis. Server mungkin sedang sibuk atau koneksi lambat. Silakan coba lagi dalam beberapa saat.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      this.dataManager.showError(errorMessage);
    }
  }

  async initialize() {
    try {
      await this.refreshData();
    } catch (error) {
      console.error("Failed to initialize dashboard:", error);
    }
  }

  async exportToExcel() {
    const exportBtn = document.getElementById("exportExcel");
    const progressModal = document.getElementById("exportProgressModal");
    const cancelBtn = document.getElementById("exportCancelBtn");
    const progressText = document.getElementById("exportProgressText");
    const progressDetail = document.getElementById("exportProgressDetail");
    const progressBar = document.getElementById("exportProgressBar");

    // AbortController untuk membatalkan export
    let exportAbortController = null;
    let isCancelled = false;

    // Cleanup function
    const cleanup = () => {
      if (progressModal) {
        progressModal.style.display = "none";
      }
      if (exportBtn) {
        exportBtn.disabled = false;
      }
      if (cancelBtn) {
        cancelBtn.onclick = null;
      }
    };

    try {
      // Disable export button
      if (exportBtn) {
        exportBtn.disabled = true;
      }

      // Show progress modal
      if (progressModal) {
        progressModal.style.display = "flex";
      }

      // Setup cancel button
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          isCancelled = true;
          if (exportAbortController) {
            exportAbortController.abort();
          }
          cleanup();
          if (progressText) {
            progressText.textContent = "Export dibatalkan";
          }
          if (progressDetail) {
            progressDetail.textContent = "Proses export telah dibatalkan";
          }
        };
      }

      // Progress callback function
      const updateProgress = (step, current, total, detail = "") => {
        if (isCancelled) return; // Don't update if cancelled

        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

        if (progressText) {
          progressText.textContent = step;
        }
        if (progressDetail) {
          progressDetail.textContent = detail || `${current} dari ${total}`;
        }
        if (progressBar) {
          progressBar.style.width = `${percentage}%`;
        }
      };

      // Modal progres dipertahankan karena membangun ZIP untuk rentang panjang
      // masih memakan waktu satu-dua detik, dan tombol batal tetap berguna.
      // Yang hilang adalah progres per-transaksi: tidak ada lagi 80k detail
      // yang diambil satu per satu, jadi tidak ada yang bisa dihitung mundur.
      updateProgress("Menyiapkan file di server...", 0, 0);

      exportAbortController = new AbortController();
      const result = await this.dataManager.downloadExport(
        exportAbortController.signal
      );

      if (isCancelled) {
        return; // Don't proceed if cancelled
      }

      updateProgress(
        "Export selesai",
        1,
        1,
        `${result.rows.toLocaleString("id-ID")} transaksi, ${Math.round(
          result.size / 1024
        ).toLocaleString("id-ID")} KB, ${result.durationMs} ms`
      );
      console.log("✅ Export ZIP terunduh:", result.filename, result);

      cleanup();
    } catch (error) {
      if (isCancelled || error.message?.includes("dibatalkan")) {
        console.log("Export cancelled by user");
        cleanup();
        return;
      }

      console.error("Failed to export Excel:", error);

      // Hide progress modal
      cleanup();

      // Show error (but not for cancellation)
      if (
        error.name !== "AbortError" &&
        !error.message?.includes("dibatalkan")
      ) {
        alert(`Gagal mengekspor data: ${error.message || "Silakan coba lagi."}`);
      }
    }
  }
}

// Shift Transaction Manager (separate from main dashboard data)
class ShiftTransactionManager {
  constructor() {
    this.api = new DashboardAPI();
    this.apiBase = this.api.apiBase;
    this.shiftETag = null;
    this.cachedShiftTransactions = null;
    this.cachedShiftDate = null;
  }

  getCurrentDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  formatIDR(amount) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(amount);
  }

  async fetchShiftTransactions(tanggalAwal, tanggalAkhir, useCache = true) {
    try {
      // Check cache first if same date range
      if (
        useCache &&
        this.cachedShiftTransactions &&
        this.cachedShiftDate === `${tanggalAwal}_${tanggalAkhir}`
      ) {
        console.log("📦 Using cached shift transactions");
        return this.cachedShiftTransactions;
      }

      const params = new URLSearchParams({
        filter_by: "periode",
        tanggal_awal: tanggalAwal,
        tanggal_akhir: tanggalAkhir,
        // PER USER REQUEST: Use explicit limit instead of "max" to avoid summary API call
        // This prevents backend from calculating limit based on total_nota (which might be empty for tomorrow)
        limit: "999999",
        offset: "0",
      });

      const url = `${this.apiBase}/api/transactions?${params}`;
      console.log("📊 Fetching shift transactions:", url);

      const headers = {
        "cache-control": "no-cache",
        ...Auth.getAuthHeaders(),
      };

      // Add ETag if available
      if (this.shiftETag && useCache) {
        headers["If-None-Match"] = this.shiftETag;
      }

      const response = await this.api.fetchWithTimeout(url, { headers });

      // Handle 304 Not Modified response
      if (response.status === 304) {
        console.log("📦 Shift transactions unchanged (304), using cached data");
        if (this.cachedShiftTransactions) {
          return this.cachedShiftTransactions;
        }
        return [];
      }

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Update ETag from response
      const newETag = response.headers.get("ETag");
      if (newETag) {
        this.shiftETag = newETag;
      }

      // Cache the data
      const transactions = data.data || [];
      this.cachedShiftTransactions = transactions;
      this.cachedShiftDate = `${tanggalAwal}_${tanggalAkhir}`;

      console.log(
        "✅ Shift transactions received:",
        transactions.length,
        "records"
      );
      return transactions;
    } catch (error) {
      console.error("❌ Error fetching shift transactions:", error);

      // Return cached data if available on error (except for timeout)
      if (
        error.name !== "TimeoutError" &&
        this.cachedShiftTransactions &&
        this.cachedShiftDate === `${tanggalAwal}_${tanggalAkhir}`
      ) {
        console.log("📦 Returning cached data due to error");
        return this.cachedShiftTransactions;
      }

      // For timeout errors, provide better error message
      if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
        throw new Error(
          "Waktu tunggu habis saat mengambil data shift. Silakan coba lagi."
        );
      }

      throw error;
    }
  }

  calculateShiftTransactions(transactions, selectedDate) {
    const shift1 = [];
    const shift2 = [];
    const shift3 = [];

    let shift1Revenue = 0;
    let shift2Revenue = 0;
    let shift3Revenue = 0;

    // Parse selected date
    const selectedDateObj = new Date(selectedDate + "T00:00:00+07:00");
    const nextDateObj = new Date(selectedDateObj);
    nextDateObj.setDate(nextDateObj.getDate() + 1);

    transactions.forEach((tx) => {
      const waktuRaw = tx.waktu_diterima_raw || tx.waktu_diterima;
      if (!waktuRaw) return;

      // Parse ISO timestamp
      const txDate = new Date(waktuRaw);
      if (isNaN(txDate.getTime())) return;

      // Get hour and minutes in local timezone (Asia/Jakarta UTC+7)
      const hour = txDate.getHours();
      const minutes = txDate.getMinutes();
      const totalMinutes = hour * 60 + minutes;

      // Get date string in local timezone
      const year = txDate.getFullYear();
      const month = String(txDate.getMonth() + 1).padStart(2, "0");
      const day = String(txDate.getDate()).padStart(2, "0");
      const txDateOnly = `${year}-${month}-${day}`;

      // Check if transaction is on selected date or next day (for shift 3)
      const isSelectedDate = txDateOnly === selectedDate;

      // Get next date string in local timezone for comparison
      const nextYear = nextDateObj.getFullYear();
      const nextMonth = String(nextDateObj.getMonth() + 1).padStart(2, "0");
      const nextDay = String(nextDateObj.getDate()).padStart(2, "0");
      const nextDateStr = `${nextYear}-${nextMonth}-${nextDay}`;
      const isNextDate = txDateOnly === nextDateStr;

      const revenue = tx.total_harga || 0;

      // Shift 1: 06:00:00 - 14:00:00 (same day, inclusive of 14:00)
      if (isSelectedDate && totalMinutes >= 6 * 60 && totalMinutes <= 14 * 60) {
        shift1.push(tx);
        shift1Revenue += revenue;
      }
      // Shift 2: 14:01:00 - 21:59:59 (same day, ends before 22:00)
      else if (
        isSelectedDate &&
        totalMinutes > 14 * 60 &&
        totalMinutes < 22 * 60
      ) {
        shift2.push(tx);
        shift2Revenue += revenue;
      }
      // Shift 3: 22:00:00 - 05:59:59 (spans to next day)
      else if (
        (isSelectedDate && totalMinutes >= 22 * 60) ||
        (isNextDate && totalMinutes < 6 * 60)
      ) {
        shift3.push(tx);
        shift3Revenue += revenue;
      }
    });

    return {
      shift1: {
        count: shift1.length,
        revenue: shift1Revenue,
      },
      shift2: {
        count: shift2.length,
        revenue: shift2Revenue,
      },
      shift3: {
        count: shift3.length,
        revenue: shift3Revenue,
      },
    };
  }

  async renderShiftTransactions(forceRefresh = false) {
    const shift1CountEl = document.getElementById("shift1Count");
    const shift2CountEl = document.getElementById("shift2Count");
    const shift3CountEl = document.getElementById("shift3Count");
    const shift1RevenueEl = document.getElementById("shift1Revenue");
    const shift2RevenueEl = document.getElementById("shift2Revenue");
    const shift3RevenueEl = document.getElementById("shift3Revenue");
    const shiftLoadingEl = document.getElementById("shiftLoading");
    const shiftDatePicker = document.getElementById("shiftDatePicker");

    if (
      !shift1CountEl ||
      !shift2CountEl ||
      !shift3CountEl ||
      !shift1RevenueEl ||
      !shift2RevenueEl ||
      !shift3RevenueEl ||
      !shiftLoadingEl ||
      !shiftDatePicker
    ) {
      console.warn("Shift transaction elements not found");
      return;
    }

    // Get selected date or default to today
    let selectedDate = shiftDatePicker.value || this.getCurrentDate();
    if (!shiftDatePicker.value) {
      shiftDatePicker.value = selectedDate;
    }

    // Show loading state
    shiftLoadingEl.style.display = "block";
    shift1CountEl.textContent = "Memuat...";
    shift2CountEl.textContent = "Memuat...";
    shift3CountEl.textContent = "Memuat...";
    shift1RevenueEl.textContent = "Memuat...";
    shift2RevenueEl.textContent = "Memuat...";
    shift3RevenueEl.textContent = "Memuat...";

    try {
      // For shift 3, we need data from selected date and next day
      const selectedDateObj = new Date(selectedDate + "T00:00:00+07:00");
      const nextDateObj = new Date(selectedDateObj);
      nextDateObj.setDate(nextDateObj.getDate() + 1);

      // Get next date string in local timezone
      const nextYear = nextDateObj.getFullYear();
      const nextMonth = String(nextDateObj.getMonth() + 1).padStart(2, "0");
      const nextDay = String(nextDateObj.getDate()).padStart(2, "0");
      const nextDateStr = `${nextYear}-${nextMonth}-${nextDay}`;

      // Fetch transactions for selected date and next day (for shift 3)
      // Use forceRefresh to bypass cache when manually refreshing
      const transactions = await this.fetchShiftTransactions(
        selectedDate,
        nextDateStr,
        !forceRefresh
      );

      // Calculate shift totals
      const shiftTotals = this.calculateShiftTransactions(
        transactions,
        selectedDate
      );

      // Update display with count and revenue
      shift1CountEl.textContent = `${shiftTotals.shift1.count} transaksi`;
      shift1RevenueEl.textContent = this.formatIDR(shiftTotals.shift1.revenue);

      shift2CountEl.textContent = `${shiftTotals.shift2.count} transaksi`;
      shift2RevenueEl.textContent = this.formatIDR(shiftTotals.shift2.revenue);

      shift3CountEl.textContent = `${shiftTotals.shift3.count} transaksi`;
      shift3RevenueEl.textContent = this.formatIDR(shiftTotals.shift3.revenue);

      console.log("✅ Shift transactions rendered:", shiftTotals);
    } catch (error) {
      console.error("❌ Error rendering shift transactions:", error);

      // Show more informative error message
      let errorText = "Error";
      if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
        errorText = "Timeout";
      } else if (error.message) {
        errorText = "Error";
      }

      shift1CountEl.textContent = errorText;
      shift2CountEl.textContent = errorText;
      shift3CountEl.textContent = errorText;
      shift1RevenueEl.textContent = errorText;
      shift2RevenueEl.textContent = errorText;
      shift3RevenueEl.textContent = errorText;
    } finally {
      shiftLoadingEl.style.display = "none";
    }
  }
}

// Initialize dashboard when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  const dashboard = new DashboardController();
  dashboard.initialize();

  // Initialize shift transaction manager (separate from main dashboard)
  const shiftManager = new ShiftTransactionManager();

  // Shift transaction card event listeners
  const shiftDatePicker = document.getElementById("shiftDatePicker");
  const refreshShiftDataBtn = document.getElementById("refreshShiftData");

  if (shiftDatePicker) {
    shiftDatePicker.addEventListener("change", () => {
      console.log("Shift date changed, refreshing transactions");
      // Clear cache when date changes to ensure fresh data for new date
      shiftManager.cachedShiftTransactions = null;
      shiftManager.cachedShiftDate = null;
      shiftManager.shiftETag = null;
      shiftManager.renderShiftTransactions(false); // Use cache if available for new date
    });
  }

  if (refreshShiftDataBtn) {
    refreshShiftDataBtn.addEventListener("click", () => {
      console.log("Refresh shift data clicked - forcing refresh");
      shiftManager.renderShiftTransactions(true); // Force refresh bypasses cache
    });
  }

  // Initial load of shift transactions
  shiftManager.renderShiftTransactions(false);
});
