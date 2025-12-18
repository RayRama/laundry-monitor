import { Hono } from "hono";
import {
  fetchTransactionSummary,
  fetchTransactionList,
  fetchTransactionDetail,
  fetchBatchTransactionDetails,
} from "../services/transactionService.js";
import { calculateETag } from "../utils/etag.js";
import { transactionCache } from "../utils/cache.js";

const transactions = new Hono();

/**
 * GET /api/transactions/summary - Get transaction summary
 */
transactions.get("/summary", async (c) => {
  try {
    const limit = c.req.query("limit") || "20";
    const offset = c.req.query("offset") || "0";
    const filterBy = c.req.query("filter_by") || "tahun";
    const tahun = c.req.query("tahun") || "2025";
    const bulan = c.req.query("bulan") || "2025-10";
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");

    const json = await fetchTransactionSummary({
      limit,
      offset,
      filterBy,
      tahun,
      bulan,
      tanggalAwal,
      tanggalAkhir,
    });

    // Calculate ETag
    const currentETag = calculateETag(json);

    // Check If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");

    if (ifNoneMatch === currentETag) {
      // Data hasn't changed, return 304
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        transactionCache.getLastSuccessTime()
          ? new Date(transactionCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return new Response(null, { status: 304 });
    }

    // Data has changed or no If-None-Match, return 200 with full data
    c.header("ETag", currentETag);
    c.header(
      "X-Last-Success",
      transactionCache.getLastSuccessTime()
        ? new Date(transactionCache.getLastSuccessTime()!).toISOString()
        : ""
    );

    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error fetching transaction summary:", error);

    // Return cached data if available
    const cached = transactionCache.summary.get();
    if (cached) {
      console.log("📦 Returning cached summary data due to error");
      const currentETag = calculateETag(cached);
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        transactionCache.getLastSuccessTime()
          ? new Date(transactionCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return c.json(cached);
    }

    return c.json(
      {
        error: "Failed to fetch transaction summary",
        message: error.message,
        data: { jumlah: 0 },
      },
      500
    );
  }
});

/**
 * GET /api/transactions - Get transaction list
 */
transactions.get("/", async (c) => {
  try {
    const limit = c.req.query("limit") || "100";
    const offset = c.req.query("offset") || "0";
    const filterBy = c.req.query("filter_by") || "bulan";
    const bulan = c.req.query("bulan") || "2025-10";
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");

    const json = await fetchTransactionList({
      limit,
      offset,
      filterBy,
      bulan,
      tanggalAwal,
      tanggalAkhir,
    });

    // Calculate ETag
    const currentETag = calculateETag(json);

    // Check If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");

    if (ifNoneMatch === currentETag) {
      // Data hasn't changed, return 304
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        transactionCache.getLastSuccessTime()
          ? new Date(transactionCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return new Response(null, { status: 304 });
    }

    // Data has changed or no If-None-Match, return 200 with full data
    c.header("ETag", currentETag);
    c.header(
      "X-Last-Success",
      transactionCache.getLastSuccessTime()
        ? new Date(transactionCache.getLastSuccessTime()!).toISOString()
        : ""
    );

    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error fetching transactions:", error);

    // Return cached data if available
    const cached = transactionCache.list.get();
    if (cached) {
      console.log("📦 Returning cached transactions data due to error");
      const currentETag = calculateETag(cached);
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        transactionCache.getLastSuccessTime()
          ? new Date(transactionCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return c.json(cached);
    }

    return c.json(
      {
        error: "Failed to fetch transactions",
        message: error.message,
        data: [],
        jumlah_nota: 0,
      },
      500
    );
  }
});

/**
 * POST /api/transactions/batch-details - Get batch transaction details
 */
transactions.post("/batch-details", async (c) => {
  try {
    const body = await c.req.json();
    const { ids } = body; // Array of idtransaksi

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json(
        {
          error: "Bad Request",
          message: "ids must be a non-empty array",
        },
        400
      );
    }

    const details = await fetchBatchTransactionDetails(ids);

    const successful = details.filter(
      (d) => d.mesin !== null || d.nama_layanan !== null
    ).length;
    const failed = details.filter((d) => d.error).length;

    return c.json({
      success: true,
      data: details,
      total: details.length,
      successful,
      failed,
    });
  } catch (error: any) {
    console.error("❌ Error fetching batch transaction details:", error);
    return c.json(
      {
        error: "Failed to fetch batch transaction details",
        message: error.message,
        data: [],
      },
      500
    );
  }
});

/**
 * GET /api/transaction-detail - Get single transaction detail
 */
transactions.get("/detail", async (c) => {
  try {
    const idtransaksi = c.req.query("idtransaksi");

    if (!idtransaksi) {
      return c.json(
        {
          error: "Bad Request",
          message: "idtransaksi parameter is required",
        },
        400
      );
    }

    const json = await fetchTransactionDetail(idtransaksi);
    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error fetching transaction detail:", error);
    return c.json(
      {
        error: "Failed to fetch transaction detail",
        message: error.message,
      },
      500
    );
  }
});

export default transactions;

