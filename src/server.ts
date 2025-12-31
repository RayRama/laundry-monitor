import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { authMiddleware } from "./auth.js";
import {
  loadControllerMap,
  refreshMachines,
} from "./services/machineService.js";

// Import routes
import machines from "./routes/machines.js";
import transactions from "./routes/transactions.js";
import leaderboard from "./routes/leaderboard.js";
import leaderboardEvents from "./routes/leaderboardEvents.js";
import employees from "./routes/employees.js";
import auth from "./routes/auth.js";
import pages from "./routes/pages.js";
import staticFiles from "./routes/static.js";

const app = new Hono();

// CORS middleware
app.use(
  "*",
  cors({
    origin: "*",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Cache-Control",
      "Pragma",
      "If-Modified-Since",
      "If-None-Match",
      "ETag",
      "Last-Modified",
    ],
    exposeHeaders: ["ETag", "Last-Modified", "X-Last-Success", "X-Data-Stale"],
  })
);

// API Routes
app.route("/api/machines", machines);
app.route("/api/transactions", transactions);
app.route("/api/leaderboard", leaderboard);
app.route("/api/leaderboard-events", leaderboardEvents);
app.route("/api/employees", employees);
app.route("/api/auth", auth);

// Manual refresh endpoint (public) - keep at /api/refresh for backward compatibility
app.post("/api/refresh", async (c) => {
  const { machineCache } = await import("./utils/cache.js");
  await refreshMachines();
  const snapshot = machineCache.get();
  return c.json({
    ok: true,
    ts: snapshot?.meta?.ts,
    stale: snapshot?.meta?.stale,
  });
});

// Transaction detail endpoint - keep at /api/transaction-detail for backward compatibility
app.get("/api/transaction-detail", async (c) => {
  const { fetchTransactionDetail } = await import(
    "./services/transactionService.js"
  );
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

// Protected routes - require authentication
app.use("/api/transactions/*", authMiddleware());
app.use("/api/leaderboard/*", authMiddleware());
app.use("/api/leaderboard-events/*", authMiddleware());
app.use("/api/machines/*/start", authMiddleware());
app.use("/api/machines/*/stop", authMiddleware());

// HTML Pages
app.route("/", pages);

// Static files
app.route("/", staticFiles);

// Public routes
app.get("/", (c) => c.text("OK"));

// Initialize and start server
async function start() {
  await loadControllerMap();
  await refreshMachines();
  setInterval(refreshMachines, config.refresh.interval);

  serve({ fetch: app.fetch, port: config.port }, () =>
    console.log(`Local API on http://localhost:${config.port}`)
  );
}

start();
