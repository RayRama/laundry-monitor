import { Hono } from "hono";
import fs from "node:fs/promises";
import { verifyToken } from "../auth.js";

const pages = new Hono();

/**
 * Helper function untuk check authentication
 */
function checkAuth(c: any): { valid: boolean; payload?: any; redirect?: string } {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const returnPath = c.req.path;
    return { valid: false, redirect: `/login?return=${returnPath}` };
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    const returnPath = c.req.path;
    return { valid: false, redirect: `/login?return=${returnPath}` };
  }

  return { valid: true, payload };
}

/**
 * Helper function untuk render access denied page
 */
function renderAccessDenied(message: string, redirectPath: string) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Access Denied</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .error { color: #e74c3c; }
        .btn { background: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1 class="error">Access Denied</h1>
      <p>${message}</p>
      <a href="${redirectPath}" class="btn">Go to Monitor</a>
    </body>
    </html>
  `;
}

/**
 * GET /dashboard - Dashboard page (admin only)
 */
pages.get("/dashboard", async (c) => {
  const auth = checkAuth(c);
  if (!auth.valid) {
    return c.redirect(auth.redirect!);
  }

  // Check if user has admin role
  if (auth.payload!.role !== "admin") {
    return c.html(renderAccessDenied("You need admin privileges to access the dashboard.", "/monitor"), 403);
  }

  try {
    const html = await fs.readFile("dashboard/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Dashboard not found", 404);
  }
});

/**
 * GET /leaderboard - Leaderboard page (admin only)
 */
pages.get("/leaderboard", async (c) => {
  const auth = checkAuth(c);
  if (!auth.valid) {
    return c.redirect(auth.redirect!);
  }

  // Check if user has admin role
  if (auth.payload!.role !== "admin") {
    return c.html(renderAccessDenied("You need admin privileges to access the leaderboard.", "/monitor"), 403);
  }

  try {
    const html = await fs.readFile("leaderboard/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Leaderboard not found", 404);
  }
});

/**
 * GET /leaderboard/events - Leaderboard Events page (admin only)
 */
pages.get("/leaderboard/events", async (c) => {
  const auth = checkAuth(c);
  if (!auth.valid) {
    return c.redirect(auth.redirect!);
  }

  // Check if user has admin role
  if (auth.payload!.role !== "admin") {
    return c.html(renderAccessDenied("You need admin privileges to access the leaderboard events.", "/monitor"), 403);
  }

  try {
    const html = await fs.readFile("leaderboard/events/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Leaderboard Events not found", 404);
  }
});

/**
 * GET /monitor - Monitor page (authenticated users)
 */
pages.get("/monitor", async (c) => {
  const auth = checkAuth(c);
  if (!auth.valid) {
    return c.redirect(auth.redirect!);
  }

  try {
    const html = await fs.readFile("monitor/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Monitor not found", 404);
  }
});

/**
 * GET /login - Login page
 */
pages.get("/login", async (c) => {
  try {
    const html = await fs.readFile("login/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Login page not found", 404);
  }
});

/**
 * GET /status - Status monitoring page (public)
 */
pages.get("/status", async (c) => {
  try {
    const html = await fs.readFile("status/index.html", "utf8");
    return c.html(html);
  } catch (error) {
    return c.text("Status page not found", 404);
  }
});

export default pages;

