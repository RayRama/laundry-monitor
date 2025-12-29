import { Hono } from "hono";
import { generateEventsLeaderboard } from "../services/leaderboardEventsService.js";
import { calculateETag } from "../utils/etag.js";
import { eventsLeaderboardCache } from "../utils/cache.js";

const leaderboardEvents = new Hono();

/**
 * GET /api/leaderboard-events - Get events leaderboard
 */
leaderboardEvents.get("/", async (c) => {
  try {
    const filter = c.req.query("filter") || "today";
    const startDate = c.req.query("start_date");
    const endDate = c.req.query("end_date");

    const responseData = await generateEventsLeaderboard({
      filter,
      startDate,
      endDate,
    });

    // Calculate ETag
    const currentETag = calculateETag(responseData);

    // Check If-None-Match header
    const ifNoneMatch = c.req.header("If-None-Match");

    if (ifNoneMatch === currentETag) {
      // Data hasn't changed, return 304
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        eventsLeaderboardCache.getLastSuccessTime()
          ? new Date(eventsLeaderboardCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return new Response(null, { status: 304 });
    }

    // Data has changed or no If-None-Match, return 200 with full data
    c.header("ETag", currentETag);
    c.header(
      "X-Last-Success",
      eventsLeaderboardCache.getLastSuccessTime()
        ? new Date(eventsLeaderboardCache.getLastSuccessTime()!).toISOString()
        : ""
    );

    // Update cache
    eventsLeaderboardCache.set(responseData);

    return c.json(responseData);
  } catch (error: any) {
    console.error("❌ Error generating events leaderboard:", error);

    // Return cached data if available
    const cached = eventsLeaderboardCache.get();
    if (cached) {
      console.log("📦 Returning cached events leaderboard data due to error");
      const currentETag = calculateETag(cached);
      c.header("ETag", currentETag);
      c.header(
        "X-Last-Success",
        eventsLeaderboardCache.getLastSuccessTime()
          ? new Date(eventsLeaderboardCache.getLastSuccessTime()!).toISOString()
          : ""
      );
      return c.json(cached);
    }

    return c.json(
      {
        success: false,
        error: "Failed to generate events leaderboard",
        message: error.message,
      },
      500
    );
  }
});

export default leaderboardEvents;
