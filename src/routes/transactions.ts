import { Hono } from "hono";
import type { Context } from "hono";
import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

const transactions = new Hono();

/**
 * GET /api/transactions/summary - Proxy to gateway
 */
transactions.get("/summary", async (c) => {
  try {
    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const queryParams = new URLSearchParams();

    // Forward all query parameters
    const limit = c.req.query("limit");
    const offset = c.req.query("offset");
    const filterBy = c.req.query("filter_by");
    const tahun = c.req.query("tahun");
    const bulan = c.req.query("bulan");
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");
    const idmesin = c.req.query("idmesin");

    if (limit) queryParams.append("limit", limit);
    if (offset) queryParams.append("offset", offset);
    if (filterBy) queryParams.append("filter_by", filterBy);
    if (tahun) queryParams.append("tahun", tahun);
    if (bulan) queryParams.append("bulan", bulan);
    if (tanggalAwal) queryParams.append("tanggal_awal", tanggalAwal);
    if (tanggalAkhir) queryParams.append("tanggal_akhir", tanggalAkhir);
    if (idmesin) queryParams.append("idmesin", idmesin);

    const url = `${eventGatewayBase}/api/transactions/summary?${queryParams}`;

    // Forward If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (ifNoneMatch) {
      headers["If-None-Match"] = ifNoneMatch;
    }

    const response = await fetchWithTimeout(url, 30000, { headers });

    // Forward status code
    if (response.status === 304) {
      // Forward headers
      const etag = response.headers.get("ETag");
      const cacheControl = response.headers.get("Cache-Control");
      const cacheStatus = response.headers.get("X-Cache-Status");
      if (etag) c.header("ETag", etag);
      if (cacheControl) c.header("Cache-Control", cacheControl);
      if (cacheStatus) c.header("X-Cache-Status", cacheStatus);
      return new Response(null, { status: 304 });
    }

    if (!response.ok) {
      throw new Error(`Gateway API ${response.status}`);
    }

    const json = await response.json();

    // Forward headers
    const etag = response.headers.get("ETag");
    const cacheControl = response.headers.get("Cache-Control");
    const cacheStatus = response.headers.get("X-Cache-Status");
    if (etag) c.header("ETag", etag);
    if (cacheControl) c.header("Cache-Control", cacheControl);
    if (cacheStatus) c.header("X-Cache-Status", cacheStatus);

    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error proxying transaction summary:", error);
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
 * GET /api/transactions - Proxy to gateway
 */
transactions.get("/", async (c) => {
  try {
    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const queryParams = new URLSearchParams();

    // Forward all query parameters
    const limit = c.req.query("limit");
    const offset = c.req.query("offset");
    const filterBy = c.req.query("filter_by");
    const bulan = c.req.query("bulan");
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");
    const idmesin = c.req.query("idmesin");

    if (limit) queryParams.append("limit", limit);
    if (offset) queryParams.append("offset", offset);
    if (filterBy) queryParams.append("filter_by", filterBy);
    if (bulan) queryParams.append("bulan", bulan);
    if (tanggalAwal) queryParams.append("tanggal_awal", tanggalAwal);
    if (tanggalAkhir) queryParams.append("tanggal_akhir", tanggalAkhir);
    if (idmesin) queryParams.append("idmesin", idmesin);

    const url = `${eventGatewayBase}/api/transactions?${queryParams}`;

    // Forward If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (ifNoneMatch) {
      headers["If-None-Match"] = ifNoneMatch;
    }

    const response = await fetchWithTimeout(url, 30000, { headers });

    // Forward status code
    if (response.status === 304) {
      // Forward headers
      const etag = response.headers.get("ETag");
      const cacheControl = response.headers.get("Cache-Control");
      const cacheStatus = response.headers.get("X-Cache-Status");
      if (etag) c.header("ETag", etag);
      if (cacheControl) c.header("Cache-Control", cacheControl);
      if (cacheStatus) c.header("X-Cache-Status", cacheStatus);
      return new Response(null, { status: 304 });
    }

    if (!response.ok) {
      throw new Error(`Gateway API ${response.status}`);
    }

    const json = await response.json();

    // Forward headers
    const etag = response.headers.get("ETag");
    const cacheControl = response.headers.get("Cache-Control");
    const cacheStatus = response.headers.get("X-Cache-Status");
    if (etag) c.header("ETag", etag);
    if (cacheControl) c.header("Cache-Control", cacheControl);
    if (cacheStatus) c.header("X-Cache-Status", cacheStatus);

    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error proxying transactions:", error);
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
 * POST /api/transactions/batch-details - Proxy to gateway
 */
transactions.post("/batch-details", async (c) => {
  try {
    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const url = `${eventGatewayBase}/api/transactions/batch-details`;

    const body = await c.req.json();

    const response = await fetchWithTimeout(url, 60000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Gateway API ${response.status}`);
    }

    const json = await response.json();
    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error proxying batch transaction details:", error);
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
 * GET /api/transactions/detail - Proxy to gateway
 */
export const handleTransactionDetail = async (c: Context) => {
  try {
    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const queryParams = new URLSearchParams();

    const idtransaksi = c.req.query("idtransaksi");
    if (idtransaksi) {
      queryParams.append("idtransaksi", idtransaksi);
    }

    if (!idtransaksi) {
      return c.json(
        {
          error: "Bad Request",
          message: "idtransaksi parameter is required",
        },
        400
      );
    }

    const url = `${eventGatewayBase}/api/transactions/detail?${queryParams}`;

    // Forward If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (ifNoneMatch) {
      headers["If-None-Match"] = ifNoneMatch;
    }

    const response = await fetchWithTimeout(url, 30000, { headers });

    // Forward status code
    if (response.status === 304) {
      // Forward headers
      const etag = response.headers.get("ETag");
      const cacheControl = response.headers.get("Cache-Control");
      const cacheStatus = response.headers.get("X-Cache-Status");
      if (etag) c.header("ETag", etag);
      if (cacheControl) c.header("Cache-Control", cacheControl);
      if (cacheStatus) c.header("X-Cache-Status", cacheStatus);
      return new Response(null, { status: 304 });
    }

    if (!response.ok) {
      throw new Error(`Gateway API ${response.status}`);
    }

    const json = await response.json();

    // Forward headers
    const etag = response.headers.get("ETag");
    const cacheControl = response.headers.get("Cache-Control");
    const cacheStatus = response.headers.get("X-Cache-Status");
    if (etag) c.header("ETag", etag);
    if (cacheControl) c.header("Cache-Control", cacheControl);
    if (cacheStatus) c.header("X-Cache-Status", cacheStatus);

    return c.json(json);
  } catch (error: any) {
    console.error("❌ Error proxying transaction detail:", error);
    return c.json(
      {
        error: "Failed to fetch transaction detail",
        message: error.message,
      },
      500
    );
  }
};

// Register detail endpoint
transactions.get("/detail", handleTransactionDetail);

export default transactions;
