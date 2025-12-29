import { Hono } from "hono";
import {
  generateFrequencyLeaderboard,
  generateRevenueLeaderboard,
} from "../services/leaderboardService.js";
import { calculateETag } from "../utils/etag.js";
import { leaderboardCache } from "../utils/cache.js";

const leaderboard = new Hono();

/**
 * GET /api/leaderboard/frequency - Get frequency leaderboard
 */
leaderboard.get("/frequency", async (c) => {
  try {
    const filterBy = c.req.query("filter_by") || "bulan";
    const bulan = c.req.query("bulan") || "2025-10";
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");

    // Check If-None-Match header FIRST (before generating data)
    const ifNoneMatch = c.req.header("If-None-Match");

    // Try to get cached data first
    const cached = leaderboardCache.frequency.get();
    
    if (cached && ifNoneMatch) {
      // Calculate ETag from cached data
      const cachedETag = calculateETag(cached);
      
      // If ETag matches, return 304 without generating new data
      if (ifNoneMatch === cachedETag) {
        console.log("📦 Frequency leaderboard unchanged (304), using cached data");
        c.header("ETag", cachedETag);
        c.header(
          "X-Last-Success",
          leaderboardCache.getLastSuccessTime()
            ? new Date(leaderboardCache.getLastSuccessTime()!).toISOString()
            : ""
        );
        return new Response(null, { status: 304 });
      }
    }

    // Data not cached or ETag doesn't match, generate new data
    console.log("🔄 Generating new frequency leaderboard data...");
    const responseData = await generateFrequencyLeaderboard({
      filterBy,
      bulan,
      tanggalAwal,
      tanggalAkhir,
    });

    // Calculate ETag from new data
    const currentETag = calculateETag(responseData);

    // Check again (in case ETag matches after generation)
    if (ifNoneMatch === currentETag) {
      // Data hasn't changed, return 304
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        leaderboardCache.getLastSuccessTime()
          ? new Date(leaderboardCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return new Response(null, { status: 304 });
    }

    // Data has changed or no If-None-Match, return 200 with full data
    c.header("ETag", currentETag);
    c.header(
      "X-Last-Success",
      leaderboardCache.getLastSuccessTime()
        ? new Date(leaderboardCache.getLastSuccessTime()!).toISOString()
        : ""
    );

    return c.json(responseData);
  } catch (error: any) {
    console.error("❌ Error generating frequency leaderboard:", error);

    // Return cached data if available
    const cached = leaderboardCache.frequency.get();
    if (cached) {
      console.log("📦 Returning cached frequency leaderboard data due to error");
      const currentETag = calculateETag(cached);
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        leaderboardCache.getLastSuccessTime()
          ? new Date(leaderboardCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return c.json(cached);
    }

    return c.json(
      {
        success: false,
        error: "Failed to generate frequency leaderboard",
        message: error.message,
      },
      500
    );
  }
});

/**
 * GET /api/leaderboard/revenue - Get revenue leaderboard
 */
leaderboard.get("/revenue", async (c) => {
  try {
    const filterBy = c.req.query("filter_by") || "bulan";
    const bulan = c.req.query("bulan") || "2025-10";
    const tanggalAwal = c.req.query("tanggal_awal");
    const tanggalAkhir = c.req.query("tanggal_akhir");

    // Check If-None-Match header FIRST (before generating data)
    const ifNoneMatch = c.req.header("If-None-Match");

    // Try to get cached data first
    const cached = leaderboardCache.revenue.get();
    
    if (cached && ifNoneMatch) {
      // Calculate ETag from cached data
      const cachedETag = calculateETag(cached);
      
      // If ETag matches, return 304 without generating new data
      if (ifNoneMatch === cachedETag) {
        console.log("📦 Revenue leaderboard unchanged (304), using cached data");
        c.header("ETag", cachedETag);
        c.header(
          "X-Last-Success",
          leaderboardCache.getLastSuccessTime()
            ? new Date(leaderboardCache.getLastSuccessTime()!).toISOString()
            : ""
        );
        return new Response(null, { status: 304 });
      }
    }

    // Data not cached or ETag doesn't match, generate new data
    console.log("🔄 Generating new revenue leaderboard data...");
    const responseData = await generateRevenueLeaderboard({
      filterBy,
      bulan,
      tanggalAwal,
      tanggalAkhir,
    });

    // Calculate ETag from new data
    const currentETag = calculateETag(responseData);

    // Check again (in case ETag matches after generation)
    if (ifNoneMatch === currentETag) {
      // Data hasn't changed, return 304
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        leaderboardCache.getLastSuccessTime()
          ? new Date(leaderboardCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return new Response(null, { status: 304 });
    }

    // Data has changed or no If-None-Match, return 200 with full data
    c.header("ETag", currentETag);
    c.header(
      "X-Last-Success",
      leaderboardCache.getLastSuccessTime()
        ? new Date(leaderboardCache.getLastSuccessTime()!).toISOString()
        : ""
    );

    return c.json(responseData);
  } catch (error: any) {
    console.error("❌ Error generating revenue leaderboard:", error);

    // Return cached data if available
    const cached = leaderboardCache.revenue.get();
    if (cached) {
      console.log("📦 Returning cached revenue leaderboard data due to error");
      const currentETag = calculateETag(cached);
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        leaderboardCache.getLastSuccessTime()
          ? new Date(leaderboardCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return c.json(cached);
    }

    return c.json(
      {
        success: false,
        error: "Failed to generate revenue leaderboard",
        message: error.message,
      },
      500
    );
  }
});

export default leaderboard;

