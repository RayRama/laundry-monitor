import { config } from "../config.js";
import { fetchWithTimeout, createUpstreamHeaders } from "../utils/fetch.js";
import { transactionCache } from "../utils/cache.js";
import type { TransactionSummary } from "../types.js";

/**
 * Build URL untuk transaction summary
 */
function buildTransactionSummaryUrl(params: {
  limit?: string;
  offset?: string;
  filterBy?: string;
  tahun?: string;
  bulan?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
  idmesin?: string;
}): string {
  const {
    limit = "20",
    offset = "0",
    filterBy = "tahun",
    tahun = "2025",
    bulan = "2025-10",
    tanggalAwal,
    tanggalAkhir,
    idmesin,
  } = params;

  const base = config.upstream.base;
  let url = `${base}/ringkasan_transaksi_snap_konsumen?sort_by=transaksi&order_by=DESC&limit=${limit}&offset=${offset}`;

  if (filterBy === "periode" && tanggalAwal && tanggalAkhir) {
    url += `&filter_by=periode&tanggal_awal=${tanggalAwal}&tanggal_akhir=${tanggalAkhir}`;
  } else if (filterBy === "bulan") {
    url += `&filter_by=bulan&bulan=${bulan}`;
  } else {
    url += `&filter_by=tahun&tahun=${tahun}`;
  }

  // Add idmesin filter if provided
  if (idmesin) {
    url += `&idmesin=${idmesin}`;
  }

  return url;
}

/**
 * Build URL untuk transaction list
 */
function buildTransactionListUrl(params: {
  limit?: string;
  offset?: string;
  filterBy?: string;
  bulan?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
}): string {
  const {
    limit = "100",
    offset = "0",
    filterBy = "bulan",
    bulan = "2025-10",
    tanggalAwal,
    tanggalAkhir,
  } = params;

  // For "max", use a very large number to get all transactions
  // Note: API might have a hard limit, but we try to get as many as possible
  const actualLimit = limit === "max" ? "99999" : limit;
  const base = config.upstream.base;
  let url = `${base}/list_transaksi_snap_konsumen?sort_by=transaksi&order_by=DESC&limit=${actualLimit}&offset=${offset}`;

  if (filterBy === "periode" && tanggalAwal && tanggalAkhir) {
    url += `&filter_by=periode&tanggal_awal=${tanggalAwal}&tanggal_akhir=${tanggalAkhir}`;
  } else {
    url += `&filter_by=bulan&bulan=${bulan}`;
  }

  return url;
}

/**
 * Fetch transaction summary dari upstream
 */
export async function fetchTransactionSummary(params: {
  limit?: string;
  offset?: string;
  filterBy?: string;
  tahun?: string;
  bulan?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
  idmesin?: string;
}): Promise<TransactionSummary> {
  const url = buildTransactionSummaryUrl(params);
  console.log(`📊 Fetching transaction summary from: ${url}`);

  const headers = createUpstreamHeaders(
    config.upstream.bearer,
    "dashboard/1.0"
  );
  const res = await fetchWithTimeout(url, 10000, { headers });

  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }

  const json = await res.json();
  console.log(
    `✅ Transaction summary fetched: ${
      json.data?.total_nota || 0
    } total transactions${
      params.idmesin ? ` for machine ${params.idmesin}` : ""
    }`
  );

  // Update cache (only if not filtered by machine)
  if (!params.idmesin) {
    transactionCache.summary.set(json);
  }
  return json;
}

/**
 * Fetch transaction list dari upstream
 */
export async function fetchTransactionList(params: {
  limit?: string;
  offset?: string;
  filterBy?: string;
  bulan?: string;
  tanggalAwal?: string;
  tanggalAkhir?: string;
}): Promise<any> {
  const url = buildTransactionListUrl(params);
  console.log(`📊 Fetching transactions from: ${url}`);

  const headers = createUpstreamHeaders(
    config.upstream.bearer,
    "dashboard/1.0"
  );
  const res = await fetchWithTimeout(url, 10000, { headers });

  if (!res.ok) {
    throw new Error(`API ${res.status}`);
  }

  const json = await res.json();
  console.log(`✅ Transactions fetched: ${json.data?.length || 0} records`);

  // Update cache
  transactionCache.list.set(json);
  return json;
}

/**
 * Fetch single transaction detail
 */
export async function fetchTransactionDetail(
  idtransaksi: string
): Promise<any> {
  const baseUrl = config.upstream.base.replace(/\/+$/, "");
  const url = `${baseUrl}/data_detail_transaksi_snap?idtransaksi=${encodeURIComponent(
    idtransaksi
  )}`;

  const headers = createUpstreamHeaders(
    config.upstream.bearer,
    "dashboard/1.0"
  );
  const res = await fetchWithTimeout(url, 10000, { headers });

  if (!res.ok) {
    throw new Error(`API returned ${res.status}`);
  }

  return await res.json();
}

/**
 * Fetch batch transaction details dengan retry logic
 */
export async function fetchBatchTransactionDetails(ids: string[]): Promise<
  Array<{
    idtransaksi: string;
    mesin: string | null;
    nama_layanan: string | null;
    error?: string;
  }>
> {
  const BATCH_SIZE = 50;
  const MAX_RETRIES = 2;
  const REQUEST_TIMEOUT = 30000;

  console.log(
    `📊 Fetching batch transaction details for ${ids.length} transactions`
  );

  const fetchDetailWithRetry = async (
    idtransaksi: string,
    retryCount = 0
  ): Promise<{
    idtransaksi: string;
    mesin: string | null;
    nama_layanan: string | null;
    error?: string;
  }> => {
    try {
      const json = await fetchTransactionDetail(idtransaksi);
      const rincianLayanan = json.data?.rincian_layanan || [];

      const mesinList: string[] = [];
      const layananList: string[] = [];

      if (Array.isArray(rincianLayanan)) {
        rincianLayanan.forEach((rincian: any) => {
          if (rincian.mesin) mesinList.push(String(rincian.mesin));
          if (rincian.nama_layanan)
            layananList.push(String(rincian.nama_layanan));
        });
      }

      return {
        idtransaksi,
        mesin: mesinList.length > 0 ? mesinList.join(", ") : null,
        nama_layanan: layananList.length > 0 ? layananList.join(", ") : null,
      };
    } catch (error: any) {
      // Retry on network errors or timeouts
      if (
        (error.name === "AbortError" ||
          error.message?.includes("aborted") ||
          error.message?.includes("timeout")) &&
        retryCount < MAX_RETRIES
      ) {
        console.log(
          `Retrying ${idtransaksi} (attempt ${
            retryCount + 1
          }/${MAX_RETRIES}) due to ${error.message}`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (retryCount + 1))
        );
        return fetchDetailWithRetry(idtransaksi, retryCount + 1);
      }

      console.error(`Error fetching detail for ${idtransaksi}:`, error);
      return {
        idtransaksi,
        mesin: null,
        nama_layanan: null,
        error: error.message || "Unknown error",
      };
    }
  };

  const details: Array<{
    idtransaksi: string;
    mesin: string | null;
    nama_layanan: string | null;
    error?: string;
  }> = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(ids.length / BATCH_SIZE);

    console.log(
      `📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} transactions)`
    );

    const batchPromises = batch.map((idtransaksi) =>
      fetchDetailWithRetry(idtransaksi)
    );
    const batchResults = await Promise.all(batchPromises);
    details.push(...batchResults);

    if (i + BATCH_SIZE < ids.length) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  const successful = details.filter(
    (d) => d.mesin !== null || d.nama_layanan !== null
  ).length;
  const failed = details.filter((d) => d.error).length;

  console.log(
    `✅ Batch transaction details fetched: ${details.length} records (${successful} successful, ${failed} failed)`
  );

  return details;
}
