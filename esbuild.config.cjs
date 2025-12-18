const { build } = require("esbuild");

build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/server.js",
  external: [
    "@hono/node-server",
    "dotenv",
    "hono",
    "jsonwebtoken",
    "bcryptjs",
  ],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
}).catch(() => process.exit(1));

