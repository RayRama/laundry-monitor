// Dashboard API Client
class DashboardAPI {
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
      if (this.lastETag) {
        headers["If-None-Match"] = this.lastETag;
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
        this.lastETag = newETag;
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
      if (this.lastETag) {
        headers["If-None-Match"] = this.lastETag;
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
        this.lastETag = newETag;
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
}

// Dashboard Data Manager
class DashboardDataManager {
  constructor() {
    this.api = new DashboardAPI();
    this.rawData = [];
    this.filteredData = [];
    this.summary = null;
    this.currentFilter = {
      filterBy: "bulan_ini",
      bulan: this.getCurrentMonth(),
      tahun: this.getCurrentYear(),
      tanggalAwal: "",
      tanggalAkhir: "",
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
      case "minggu_ini":
        return { tanggalAwal: this.getWeekStartDate(), tanggalAkhir: today };
      case "bulan_ini":
        return { tanggalAwal: this.getMonthStartDate(), tanggalAkhir: today };
      default:
        return null;
    }
  }

  async loadData() {
    this.setLoading(true);

    try {
      // First get summary to determine total count
      const summaryParams = this.buildSummaryParams();
      const summaryData = await this.api.getTransactionSummary(summaryParams);

      // Only update summary if we got new data (not 304)
      if (summaryData) {
        this.summary = summaryData;

        // Store total_nota for future use
        if (this.summary?.data?.total_nota) {
          const newTotalNota = this.summary.data.total_nota;
          const currentTotalNota = this.getTotalNota();

          // Force update if different
          if (currentTotalNota !== newTotalNota) {
            console.log(
              `📊 Total nota changed: ${currentTotalNota} → ${newTotalNota}`
            );
            this.setTotalNota(newTotalNota);
          } else {
            console.log("📊 Total nota unchanged:", newTotalNota);
          }

          console.log("📊 Summary data:", this.summary.data);
        } else {
          console.log("⚠️ No total_nota in summary data:", this.summary);
        }
      }

      // Then get actual transaction data
      const transactionParams = this.buildTransactionParams();
      const transactionData = await this.api.getTransactions(transactionParams);

      // Only update transaction data if we got new data (not 304)
      if (transactionData) {
        this.rawData = this.normalizeData(transactionData.data || []);
        this.filteredData = [...this.rawData];
      }

      console.log("✅ Data loaded successfully:", {
        summary: this.summary,
        transactions: this.rawData.length,
        totalNota: this.getTotalNota(),
        summaryUpdated: !!summaryData,
        transactionsUpdated: !!transactionData,
      });

      return {
        summary: this.summary,
        transactions: this.rawData,
      };
    } catch (error) {
      console.error("❌ Failed to load data:", error);
      this.showError("Gagal memuat data: " + error.message);
      throw error;
    } finally {
      this.setLoading(false);
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
      params.filter_by = "tahun";
      params.tahun = this.currentFilter.tahun;
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
      // Get jumlah_nota from summary or localStorage
      const totalNota = this.getTotalNota();
      params.limit = totalNota ? totalNota.toString() : "100";
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
      params.filter_by = "tahun";
      params.tahun = this.currentFilter.tahun;
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
    } else if (this.currentFilter.filterBy === "minggu_ini") {
      return "Minggu Ini";
    } else if (this.currentFilter.filterBy === "bulan_ini") {
      return "Bulan Ini";
    } else if (this.currentFilter.filterBy === "periode") {
      if (this.currentFilter.tanggalAwal && this.currentFilter.tanggalAkhir) {
        const startDate = new Date(this.currentFilter.tanggalAwal);
        const endDate = new Date(this.currentFilter.tanggalAkhir);
        return `Periode ${startDate.toLocaleDateString(
          "id-ID"
        )} - ${endDate.toLocaleDateString("id-ID")}`;
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

  async enrichTransactionsWithDetails(transactions, progressCallback = null) {
    const ids = transactions
      .map((t) => t.idtransaksi)
      .filter((id) => id);

    if (ids.length === 0) {
      return transactions;
    }

    try {
      if (progressCallback) {
        progressCallback(
          "Mengambil detail transaksi (mesin & layanan)...",
          0,
          ids.length,
          "Memulai fetch batch..."
        );
      }

      // Calculate batch count and time estimates
      const batchCount = Math.ceil(ids.length / 50);
      // Estimate: ~1 second per batch (50 transactions)
      const estimatedSeconds = batchCount * 1;
      const estimatedMinutes = Math.floor(estimatedSeconds / 60);
      const estimatedSecondsRemainder = estimatedSeconds % 60;
      const timeEstimate =
        estimatedMinutes > 0
          ? `Estimasi waktu: ~${estimatedMinutes}m ${Math.round(estimatedSecondsRemainder)}s`
          : `Estimasi waktu: ~${Math.round(estimatedSeconds)}s`;

      // Start progress simulation with interval timer
      let progressInterval = null;
      const startTime = Date.now();
      let currentProgress = 0;

      if (progressCallback) {
        progressCallback(
          `Memproses ${ids.length} transaksi dalam batch...`,
          0,
          ids.length,
          timeEstimate
        );

        // Update progress every 500ms based on elapsed time
        progressInterval = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000; // seconds
          // Estimate progress: assume linear progress over estimated time
          // Use 80% of estimated time to account for variability and show progress faster
          const estimatedTotalTime = Math.max(estimatedSeconds * 0.8, 1); // At least 1 second
          const progressRatio = Math.min(elapsed / estimatedTotalTime, 0.95); // Cap at 95% until done
          currentProgress = Math.min(
            Math.floor(progressRatio * ids.length),
            ids.length
          );

          const elapsedMinutes = Math.floor(elapsed / 60);
          const elapsedSeconds = Math.floor(elapsed % 60);
          const elapsedTime =
            elapsedMinutes > 0
              ? `${elapsedMinutes}m ${elapsedSeconds}s`
              : `${elapsedSeconds}s`;

          const batchProgress = Math.floor((currentProgress / ids.length) * batchCount);
          progressCallback(
            `Memproses ${ids.length} transaksi dalam batch...`,
            currentProgress,
            ids.length,
            `Batch ${batchProgress}/${batchCount} • ${currentProgress} dari ${ids.length} (${elapsedTime})`
          );
        }, 500); // Update every 500ms
      }

      // Fetch batch details from API with increased timeout
      // For large batches, we need more time
      // Add buffer: multiply by 2 for safety
      const timeoutMs = Math.max(120000, estimatedSeconds * 2000); // Min 120s (2 minutes), or 2s per batch

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(
          `${this.api.apiBase}/api/transactions/batch-details`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...Auth.getAuthHeaders(),
            },
            body: JSON.stringify({ ids }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);
        // Stop progress interval
        if (progressInterval) {
          clearInterval(progressInterval);
        }

        if (!response.ok) {
          throw new Error(`API Error: ${response.status}`);
        }

        const result = await response.json();
        const detailsMap = new Map(
          (result.data || []).map((d) => [d.idtransaksi, d])
        );

        // Count successful vs failed
        const successful = result.data?.filter(
          (d) => d.mesin !== null || d.nama_layanan !== null
        ).length || 0;
        const failed = result.data?.filter((d) => d.error).length || 0;

        if (progressCallback) {
          // Final update with actual count
          progressCallback(
            "Detail transaksi berhasil diambil",
            ids.length,
            ids.length,
            `${ids.length} dari ${ids.length} detail terambil (${successful} berhasil${failed > 0 ? `, ${failed} gagal` : ""})`
          );
        }

        // Merge details with transactions
        return transactions.map((t) => {
          const detail = detailsMap.get(t.idtransaksi);
          return {
            ...t,
            mesin: detail?.mesin || "-",
            nama_layanan: detail?.nama_layanan || "-",
          };
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        // Stop progress interval on error
        if (progressInterval) {
          clearInterval(progressInterval);
        }
        if (fetchError.name === "AbortError") {
          throw new Error(
            `Timeout: Proses terlalu lama untuk ${ids.length} transaksi. Silakan coba dengan periode yang lebih kecil.`
          );
        }
        throw fetchError;
      }
    } catch (error) {
      console.error("Error enriching transactions:", error);
      // Return original transactions if enrichment fails
      return transactions.map((t) => ({
        ...t,
        mesin: "-",
        nama_layanan: "-",
      }));
    }
  }

  async exportExcel(renderer, progressCallback = null) {
    if (!window.XLSX) {
      throw new Error("SheetJS library tidak dimuat");
    }

    const transactions = this.filteredData || [];
    const summary = this.summary;
    const stats = renderer.computeStats(transactions);

    // Fetch transaction details with progress
    if (progressCallback) {
      progressCallback(
        "Mengambil detail transaksi (mesin & layanan)...",
        0,
        transactions.length
      );
    }

    const enrichedTransactions = await this.enrichTransactionsWithDetails(
      transactions,
      progressCallback
    );

    if (progressCallback) {
      progressCallback("Menyusun data Excel...", transactions.length, transactions.length);
    }

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Helper function to format date
    const formatDate = (date) => {
      if (!date) return "-";
      const d = new Date(date);
      if (isNaN(d.getTime())) return "-";
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };

    // Helper function to format time
    const formatTime = (date) => {
      if (!date) return "-";
      const d = new Date(date);
      if (isNaN(d.getTime())) return "-";
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`;
    };

    // Helper function to get day name
    const getDayName = (date) => {
      if (!date) return "-";
      const d = new Date(date);
      if (isNaN(d.getTime())) return "-";
      const days = [
        "Minggu",
        "Senin",
        "Selasa",
        "Rabu",
        "Kamis",
        "Jumat",
        "Sabtu",
      ];
      return days[d.getDay()];
    };

    // Helper function to get month name
    const getMonthName = (date) => {
      if (!date) return "-";
      const d = new Date(date);
      if (isNaN(d.getTime())) return "-";
      const months = [
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
      return months[d.getMonth()];
    };

    // Helper function to determine shift
    const getShift = (date) => {
      if (!date) return "-";
      const d = new Date(date);
      if (isNaN(d.getTime())) return "-";
      const hour = d.getHours();
      const minutes = d.getMinutes();
      const totalMinutes = hour * 60 + minutes;

      if (totalMinutes >= 360 && totalMinutes <= 840) {
        // 06:00 - 14:00
        return "Shift 1";
      } else if (totalMinutes >= 841 && totalMinutes <= 1319) {
        // 14:01 - 21:59
        return "Shift 2";
      } else {
        // 22:00 - 05:59
        return "Shift 3";
      }
    };

    // Helper function to format IDR
    const formatIDR = (amount) => {
      return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(amount);
    };

    // Sheet 1: Transaksi Detail
    const detailData = enrichedTransactions.map((r) => {
      const time = r.dt ? new Date(r.dt) : null;
      const paid = +r.status_lunas === 1;
      const done = +r.status_selesai === 2;

      return {
        Tanggal: formatDate(time),
        Jam: formatTime(time),
        "ID Transaksi": r.idtransaksi || "-",
        "Jenis Transaksi": r.jenis_transaksi_formated || "-",
        "Nama Customer": r.nama_customer || "-",
        Mesin: r.mesin || "-",
        "Nama Layanan": r.nama_layanan || "-",
        Nominal: r.total_harga || 0,
        "Status Paid": paid ? "Ya" : "Tidak",
        "Status Selesai": done ? "Selesai" : "Proses",
        Shift: getShift(time),
        Hari: getDayName(time),
        Bulan: getMonthName(time),
        Tahun: time ? time.getFullYear() : "-",
      };
    });

    const wsDetail = XLSX.utils.json_to_sheet(detailData);
    XLSX.utils.book_append_sheet(wb, wsDetail, "Transaksi Detail");

    // Sheet 2: Summary
    const dateRange = this.getFilterDescription();
    const exportDate = new Date().toLocaleString("id-ID");
    const paidRate = stats.tx ? (stats.paid / stats.tx) * 100 : 0;

    const summaryData = [
      { Metrik: "Total Omzet (IDR)", Nilai: stats.rev },
      { Metrik: "Total Transaksi", Nilai: stats.tx },
      { Metrik: "AOV (Average Order Value) (IDR)", Nilai: stats.aov },
      { Metrik: "Paid Rate (%)", Nilai: paidRate },
      { Metrik: "Jumlah Paid", Nilai: stats.paid },
      { Metrik: "Jumlah Selesai", Nilai: stats.finished },
      { Metrik: "Omzet per Hari (IDR)", Nilai: stats.perday },
      { Metrik: "Pertumbuhan d/d", Nilai: stats.growthText || "-" },
      { Metrik: "Periode Filter", Nilai: dateRange },
      { Metrik: "Tanggal Export", Nilai: exportDate },
    ];

    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    // Sheet 3: Transaksi per Shift
    const shiftMap = new Map();
    transactions.forEach((r) => {
      const time = r.dt ? new Date(r.dt) : null;
      if (!time) return;

      const shift = getShift(time);
      const dateStr = formatDate(time);

      const key = `${dateStr}_${shift}`;
      if (!shiftMap.has(key)) {
        shiftMap.set(key, {
          Tanggal: dateStr,
          Shift: shift,
          "Waktu Shift":
            shift === "Shift 1"
              ? "06:00-14:00"
              : shift === "Shift 2"
              ? "14:01-21:59"
              : "22:00-05:59",
          "Jumlah Transaksi": 0,
          "Total Omzet": 0,
          "Rata-rata per Transaksi": 0,
        });
      }

      const shiftData = shiftMap.get(key);
      shiftData["Jumlah Transaksi"] += 1;
      shiftData["Total Omzet"] += r.total_harga || 0;
    });

    // Calculate average (keep as number for Excel calculation)
    shiftMap.forEach((data) => {
      data["Rata-rata per Transaksi"] =
        data["Jumlah Transaksi"] > 0
          ? data["Total Omzet"] / data["Jumlah Transaksi"]
          : 0;
    });

    const shiftData = Array.from(shiftMap.values()).sort((a, b) => {
      const dateA = new Date(a.Tanggal.split("/").reverse().join("-"));
      const dateB = new Date(b.Tanggal.split("/").reverse().join("-"));
      if (dateA.getTime() !== dateB.getTime()) {
        return dateA - dateB;
      }
      const shiftOrder = { "Shift 1": 1, "Shift 2": 2, "Shift 3": 3 };
      return (shiftOrder[a.Shift] || 0) - (shiftOrder[b.Shift] || 0);
    });

    const wsShift = XLSX.utils.json_to_sheet(shiftData);
    XLSX.utils.book_append_sheet(wb, wsShift, "Transaksi per Shift");

    // Sheet 4: Omzet Harian
    const dailyMap = new Map();
    transactions.forEach((r) => {
      if (!r.dt) return;
      const dateStr = formatDate(r.dt);

      if (!dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, {
          Tanggal: dateStr,
          Omzet: 0,
          "Jumlah Transaksi": 0,
          AOV: 0,
        });
      }

      const dailyData = dailyMap.get(dateStr);
      dailyData.Omzet += r.total_harga || 0;
      dailyData["Jumlah Transaksi"] += 1;
    });

    // Calculate AOV (keep as number for Excel calculation)
    dailyMap.forEach((data) => {
      data.AOV =
        data["Jumlah Transaksi"] > 0
          ? data.Omzet / data["Jumlah Transaksi"]
          : 0;
    });

    const dailyData = Array.from(dailyMap.values()).sort((a, b) => {
      const dateA = new Date(a.Tanggal.split("/").reverse().join("-"));
      const dateB = new Date(b.Tanggal.split("/").reverse().join("-"));
      return dateA - dateB;
    });

    const wsDaily = XLSX.utils.json_to_sheet(dailyData);
    XLSX.utils.book_append_sheet(wb, wsDaily, "Omzet Harian");

    // Sheet 5: Transaksi per Jam
    const hourlyMap = new Map();
    transactions.forEach((r) => {
      if (!r.dt) return;
      const d = new Date(r.dt);
      const hour = d.getHours();

      if (!hourlyMap.has(hour)) {
        hourlyMap.set(hour, {
          Jam: `${String(hour).padStart(2, "0")}:00`,
          "Jumlah Transaksi": 0,
          "Total Omzet": 0,
        });
      }

      const hourlyData = hourlyMap.get(hour);
      hourlyData["Jumlah Transaksi"] += 1;
      hourlyData["Total Omzet"] += r.total_harga || 0;
    });

    const hourlyData = Array.from(hourlyMap.values()).sort((a, b) => {
      const hourA = parseInt(a.Jam.split(":")[0]);
      const hourB = parseInt(b.Jam.split(":")[0]);
      return hourA - hourB;
    });

    const wsHourly = XLSX.utils.json_to_sheet(hourlyData);
    XLSX.utils.book_append_sheet(wb, wsHourly, "Transaksi per Jam");

    // Generate filename
    const filterDesc = this.getFilterDescription().replace(
      /[^a-zA-Z0-9]/g,
      "_"
    );
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const filename = `Dashboard_Export_${filterDesc}_${timestamp}.xlsx`;

    if (progressCallback) {
      progressCallback(
        "Menyimpan file Excel...",
        enrichedTransactions.length,
        enrichedTransactions.length,
        "Hampir selesai..."
      );
    }

    // Write file
    XLSX.writeFile(wb, filename);

    if (progressCallback) {
      progressCallback(
        "Export selesai!",
        enrichedTransactions.length,
        enrichedTransactions.length,
        "File berhasil dibuat"
      );
    }

    console.log("✅ Excel file exported:", filename);
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
    const stats = this.computeStats(data.transactions);

    document.getElementById("kpi-revenue").textContent = this.IDR.format(
      stats.rev
    );
    document.getElementById("kpi-aov").textContent = `AOV ${this.IDR.format(
      stats.aov
    )}`;
    document.getElementById("kpi-tx").textContent =
      stats.tx.toLocaleString("id-ID");

    // Date range
    let rangeTxt = "Semua data";
    if (data.transactions.length) {
      const minD = new Date(
        Math.min(...data.transactions.map((r) => (r.dt ? +r.dt : Infinity)))
      );
      const maxD = new Date(
        Math.max(...data.transactions.map((r) => (r.dt ? +r.dt : -Infinity)))
      );
      rangeTxt = `${this.DTF.format(minD)} – ${this.DTF.format(maxD)}`;
    }
    document.getElementById("kpi-date-range").textContent = rangeTxt;

    // Paid rate
    const paidRate = stats.tx ? (stats.paid / stats.tx) * 100 : 0;
    const finishedRate = stats.tx ? (stats.finished / stats.tx) * 100 : 0;
    document.getElementById("kpi-paid").textContent = paidRate.toFixed(1) + "%";
    document.getElementById("kpi-paid-pill").textContent = stats.paid + " paid";
    document.getElementById("kpi-finished").textContent = `Finish ${
      stats.finished
    } (${finishedRate.toFixed(1)}%)`;

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

  computeStats(rows) {
    const tx = rows.length;
    const rev = rows.reduce((a, b) => a + (b.total_harga || 0), 0);
    const aov = tx ? rev / tx : 0;
    const paid = rows.filter((r) => +r.status_lunas === 1).length;
    const finished = rows.filter((r) => +r.status_selesai === 2).length;

    // Daily
    const byDayMap = new Map();
    rows.forEach((r) => {
      if (!r.dt) return;
      // Use local timezone instead of UTC
      const year = r.dt.getFullYear();
      const month = String(r.dt.getMonth() + 1).padStart(2, "0");
      const day = String(r.dt.getDate()).padStart(2, "0");
      const d = `${year}-${month}-${day}`;

      const cur = byDayMap.get(d) || { date: d, rev: 0, tx: 0 };
      cur.rev += r.total_harga || 0;
      cur.tx += 1;
      byDayMap.set(d, cur);
    });
    const byDay = Array.from(byDayMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

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

    const perday = byDay.length ? rev / byDay.length : 0;

    // Hourly
    const byHour = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      tx: 0,
      rev: 0,
    }));
    rows.forEach((r) => {
      if (!r.dt) return;
      const h = r.dt.getHours();
      byHour[h].tx += 1;
      byHour[h].rev += r.total_harga || 0;
    });

    // Ticket buckets
    const buckets = [
      { label: "<= 5k", min: 0, max: 5000 },
      { label: "5k–10k", min: 5001, max: 10000 },
      { label: "10k–15k", min: 10001, max: 15000 },
      { label: "> 15k", min: 15001, max: 1e12 },
    ];
    const bucketCounts = buckets.map((b) => ({
      label: b.label,
      count: rows.filter(
        (r) => (r.total_harga || 0) >= b.min && (r.total_harga || 0) <= b.max
      ).length,
    }));

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
    const heat = Array.from({ length: 7 }, (_, i) =>
      Array.from({ length: 24 }, () => 0)
    );
    rows.forEach((r) => {
      if (!r.dt) return;
      const day = r.dt.getDay();
      const hour = r.dt.getHours();
      heat[day][hour] += 1;
    });

    // Weekly aggregation
    const byWeekMap = new Map();
    rows.forEach((r) => {
      if (!r.dt) return;
      const date = new Date(r.dt);
      const weekStart = this.getWeekStart(date);
      const weekKey = weekStart.toISOString().slice(0, 10);

      const cur = byWeekMap.get(weekKey) || {
        date: weekKey,
        rev: 0,
        tx: 0,
        weekLabel: this.getWeekLabel(weekStart),
      };
      cur.rev += r.total_harga || 0;
      cur.tx += 1;
      byWeekMap.set(weekKey, cur);
    });
    const byWeek = Array.from(byWeekMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    return {
      tx,
      rev,
      aov,
      paid,
      finished,
      byDay,
      byWeek,
      byHour,
      bucketCounts,
      perday,
      growthText,
      heat,
      days,
    };
  }

  renderCharts(data) {
    const stats = this.computeStats(data.transactions);

    this.renderDailyChart(stats);
    // this.renderTicketChart(stats); // Chart removed from UI
    this.renderWeeklyChart(stats);
    this.renderTransactionDailyChart(stats);
    this.renderCombinedChart(stats);
    this.renderHourlyChart(stats);
    this.renderHeatMap(stats);
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
        const paid = +r.status_lunas === 1;
        const done = +r.status_selesai === 2;
        const time = r.dt ? new Date(r.dt) : null;
        const d = time ? time.toLocaleDateString("id-ID") : "-";
        const h = time
          ? this.pad2(time.getHours()) + ":" + this.pad2(time.getMinutes())
          : "-";
        return `<tr>
        <td>${d}</td>
        <td>${h}</td>
        <td class="font-mono text-xs">${r.idtransaksi || "-"}</td>
        <td>${r.jenis_transaksi_formated || "–"}</td>
        <td>${r.nama_customer || "–"}</td>
        <td class="text-right font-semibold">${this.IDR.format(
          r.total_harga || 0
        )}</td>
        <td>${
          paid
            ? '<span class="pill pill-green">Ya</span>'
            : '<span class="pill pill-red">Tidak</span>'
        }</td>
        <td>${
          done
            ? '<span class="pill pill-green">Selesai</span>'
            : '<span class="pill pill-amber">Proses</span>'
        }</td>
      </tr>`;
      })
      .join("");
  }

  makeChart(ctxId, cfg) {
    if (this.charts[ctxId]) {
      this.charts[ctxId].destroy();
    }
    const ctx = document.getElementById(ctxId);
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

    document.getElementById("filterBy").value = "bulan_ini";
    document.getElementById("bulan").value = currentMonth;
    document.getElementById("tahun").value = currentYear;
    document.getElementById("tanggalAwal").value = defaultStartDate;
    document.getElementById("tanggalAkhir").value = currentDate;

    // Initialize filter type display
    this.updateFilterType("bulan_ini");
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
    document.getElementById("filterBy").value = "bulan_ini";
    document.getElementById("bulan").value = this.dataManager.getCurrentMonth();
    document.getElementById("tahun").value = this.dataManager.getCurrentYear();
    document.getElementById("tanggalAwal").value =
      this.dataManager.getDefaultStartDate();
    document.getElementById("tanggalAkhir").value =
      this.dataManager.getCurrentDate();
    document.getElementById("limitType").value = "max";
    document.getElementById("customLimit").value = "100";

    this.updateFilterType("bulan_ini");
    this.updateLimitType("max");

    const defaultFilter = {
      filterBy: "bulan_ini",
      bulan: this.dataManager.getCurrentMonth(),
      tahun: this.dataManager.getCurrentYear(),
      tanggalAwal: this.dataManager.getDefaultStartDate(),
      tanggalAkhir: this.dataManager.getCurrentDate(),
      limit: "max",
    };

    this.dataManager.updateFilter(defaultFilter);
    this.refreshData();
  }

  async refreshData() {
    try {
      this.dataManager.showSuccess("Memuat data terbaru...");
      const data = await this.dataManager.loadData();
      this.renderer.render(data);
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
    const progressText = document.getElementById("exportProgressText");
    const progressDetail = document.getElementById("exportProgressDetail");
    const progressBar = document.getElementById("exportProgressBar");
    const totalTransactionsEl = document.getElementById("exportTotalTransactions");
    const detailsFetchedEl = document.getElementById("exportDetailsFetched");

    try {
      // Disable export button
      if (exportBtn) {
        exportBtn.disabled = true;
      }

      // Show progress modal
      if (progressModal) {
        progressModal.style.display = "flex";
      }

      // Progress callback function
      const updateProgress = (step, current, total, detail = "") => {
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
        if (totalTransactionsEl) {
          totalTransactionsEl.textContent = total;
        }
        if (detailsFetchedEl) {
          detailsFetchedEl.textContent = current;
        }
      };

      // Initial progress
      updateProgress("Mempersiapkan data...", 0, 0);

      // Export with progress updates
      await this.dataManager.exportExcel(this.renderer, updateProgress);

      // Hide progress modal
      if (progressModal) {
        progressModal.style.display = "none";
      }

      // Re-enable export button
      if (exportBtn) {
        exportBtn.disabled = false;
      }
    } catch (error) {
      console.error("Failed to export Excel:", error);
      
      // Hide progress modal
      if (progressModal) {
        progressModal.style.display = "none";
      }

      // Show error
      alert("Gagal mengekspor data ke Excel. Silakan coba lagi.");

      // Re-enable export button
      if (exportBtn) {
        exportBtn.disabled = false;
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
        limit: "max",
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
