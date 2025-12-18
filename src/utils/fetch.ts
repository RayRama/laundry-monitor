/**
 * Fetch dengan timeout
 */
export async function fetchWithTimeout(
  url: string,
  ms: number,
  init: RequestInit = {}
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const mergedInit: RequestInit = { ...init, signal: ctrl.signal };
    // Pastikan headers tergabung jika ada
    if (init.headers) {
      mergedInit.headers = init.headers as Record<string, string>;
    }
    return await fetch(url, mergedInit);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Membuat headers untuk upstream API request
 */
export function createUpstreamHeaders(
  bearer?: string,
  userAgent = "api-client/1.0"
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": userAgent,
  };
  if (bearer) {
    headers["Authorization"] = `Bearer ${bearer}`;
  }
  return headers;
}
