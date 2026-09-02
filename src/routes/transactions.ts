import { Hono } from "hono";
import type { Context } from "hono";
import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { gatewayHeaders } from "../utils/gatewayHeaders.js";

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
    Object.assign(headers, gatewayHeaders(c));
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

    const url = `${eventGatewayBase}/api/transactions?${queryParams}`;

    // Forward If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    Object.assign(headers, gatewayHeaders(c));
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
      headers: gatewayHeaders(c, {
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
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
    Object.assign(headers, gatewayHeaders(c));
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

/**
 * GET /api/transactions/analytics - Proxy to gateway
 *
 * Satu panggilan berisi KPI, rollup grafik, dan baris tabel. Menggantikan pola
 * lama yang menarik ~80k baris (`limit=max`) hanya untuk diagregasi di browser.
 */
transactions.get("/analytics", async (c) => {
  try {
    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const queryParams = new URLSearchParams();
    for (const key of [
      "tanggal_awal",
      "tanggal_akhir",
      "idmesin",
      "rows",
    ] as const) {
      const value = c.req.query(key);
      if (value) queryParams.append(key, value);
    }

    const url = `${eventGatewayBase}/api/transactions/analytics?${queryParams}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    Object.assign(headers, gatewayHeaders(c));
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;

    const response = await fetchWithTimeout(url, 60000, { headers });

    const etag = response.headers.get("ETag");
    const cacheStatus = response.headers.get("X-Cache-Status");
    const covered = response.headers.get("X-Mv-Covered-Through");
    if (etag) c.header("ETag", etag);
    if (cacheStatus) c.header("X-Cache-Status", cacheStatus);
    if (covered) c.header("X-Mv-Covered-Through", covered);

    if (response.status === 304) return new Response(null, { status: 304 });
    if (!response.ok) throw new Error(`Gateway API ${response.status}`);

    return c.json(await response.json());
  } catch (error: any) {
    console.error("❌ Error proxying transaction analytics:", error);
    return c.json(
      { error: "Failed to fetch transaction analytics", message: error.message },
      500
    );
  }
});

/**
 * GET /api/transactions/export - Proxy to gateway (ZIP berisi 5 CSV)
 *
 * Body diteruskan apa adanya tanpa dibaca ke memori: arsipnya sudah dirakit di
 * gateway, dan mem-buffer ulang di sini hanya menggandakan penggunaan memori
 * pada fungsi serverless yang jatahnya justru paling ketat.
 */
transactions.get("/export", async (c) => {
  try {
    const eventGatewayBase =
      config.eventGateway?.base || "http://localhost:54990";
    const queryParams = new URLSearchParams();
    for (const key of ["tanggal_awal", "tanggal_akhir", "idmesin"] as const) {
      const value = c.req.query(key);
      if (value) queryParams.append(key, value);
    }

    const url = `${eventGatewayBase}/api/transactions/export?${queryParams}`;
    // Merakit ZIP untuk rentang setahun butuh waktu lebih lama dari proxy lain.
    const response = await fetchWithTimeout(url, 180000, {
      headers: gatewayHeaders(c, { Accept: "application/zip" }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gateway API ${response.status} ${detail}`.trim());
    }

    const headers = new Headers();
    for (const key of [
      "Content-Type",
      "Content-Disposition",
      "Content-Length",
      "Cache-Control",
      "X-Export-Rows",
      "X-Export-Duration-Ms",
      "X-Mv-Covered-Through",
    ]) {
      const value = response.headers.get(key);
      if (value) headers.set(key, value);
    }

    return new Response(response.body, { status: 200, headers });
  } catch (error: any) {
    console.error("❌ Error proxying transaction export:", error);
    return c.json(
      { error: "Failed to build transaction export", message: error.message },
      500
    );
  }
});

export default transactions;
