import type { Context } from "hono";

/** Preserve the user's authenticated gateway session through the frontend BFF. */
export function gatewayHeaders(
  c: Context,
  base: Record<string, string> = {}
): Record<string, string> {
  const headers = { ...base };
  const authorization = c.req.header("Authorization");
  const cookie = c.req.header("Cookie");
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  return headers;
}
