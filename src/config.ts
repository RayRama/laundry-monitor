import dotenv from "dotenv";

// Load env dari .env.local (jika ada) lalu fallback ke .env
dotenv.config({ path: ".env.local" });
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  upstream: {
    base: process.env.UPSTREAM_BASE!,
    outletId: process.env.OUTLET_ID!,
    bearer: process.env.UPSTREAM_BEARER || process.env.BEARER_TOKEN || "",
    timeout: Number(process.env.UPSTREAM_TIMEOUT_MS || 2000),
  },
  refresh: {
    interval: 180000, // 3 menit
    staleThreshold: 2 * 60 * 1000, // 2 menit
  },
} as const;
