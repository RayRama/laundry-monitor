import { Hono } from "hono";
import fs from "node:fs/promises";

const staticFiles = new Hono();

/**
 * GET /styles/* - Serve CSS files
 */
staticFiles.get("/styles/*", async (c) => {
  const path = c.req.path.replace("/styles/", "styles/");
  try {
    const content = await fs.readFile(path, "utf8");
    return c.text(content, 200, { "Content-Type": "text/css" });
  } catch (error) {
    return c.text("File not found", 404);
  }
});

/**
 * GET /scripts/* - Serve JavaScript files
 */
staticFiles.get("/scripts/*", async (c) => {
  const path = c.req.path.replace("/scripts/", "scripts/");
  try {
    const content = await fs.readFile(path, "utf8");
    return c.text(content, 200, { "Content-Type": "application/javascript" });
  } catch (error) {
    return c.text("File not found", 404);
  }
});

/**
 * GET /assets/* - Serve asset files
 */
staticFiles.get("/assets/*", async (c) => {
  const path = c.req.path.replace("/assets/", "assets/");
  try {
    const content = await fs.readFile(path);
    const ext = path.split(".").pop();
    const contentType =
      ext === "svg" ? "image/svg+xml" : "application/octet-stream";
    return new Response(content, { headers: { "Content-Type": contentType } });
  } catch (error) {
    return c.text("File not found", 404);
  }
});

export default staticFiles;

