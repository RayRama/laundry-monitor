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
import events from "./routes/events.js";
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
app.route("/api/events", events);
app.route("/api/auth", auth);

// Manual refresh endpoint (public) - changed from POST to GET for RESTful compliance
app.get("/api/refresh", async (c) => {
  const { machineCache } = await import("./utils/cache.js");
  await refreshMachines();
  const snapshot = machineCache.get();
  return c.json({
    ok: true,
    ts: snapshot?.meta?.ts,
    stale: snapshot?.meta?.stale,
  });
});

// Transaction detail endpoint - backward compatibility for /api/transaction-detail
// Uses the same handler from transactions route
app.get("/api/transaction-detail", authMiddleware(), async (c) => {
  const { handleTransactionDetail } = await import("./routes/transactions.js");
  return handleTransactionDetail(c);
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
