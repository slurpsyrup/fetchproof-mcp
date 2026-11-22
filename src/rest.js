/**
 * REST client for api.fetchproof.com. The user's key is sent as a header only.
 */

export const DEFAULT_BASE_URL = "https://api.fetchproof.com";
export const PACKAGE_VERSION = "0.1.0";

export function baseUrlFromEnv(env = process.env) {
  return (env.FETCHPROOF_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

export function apiKeyFromEnv(env = process.env) {
  const key = env.FETCHPROOF_API_KEY;
  return typeof key === "string" ? key.trim() : "";
}

export function timeoutMsFromEnv(env = process.env) {
  const raw = env.FETCHPROOF_TIMEOUT_MS;
  const n = raw ? Number(raw) : 60_000;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

export function requestUrl(base, path, params = {}) {
  let resolved = path;
  const query = { ...params };
  resolved = resolved.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => {
    const value = query[name];
    delete query[name];
    if (value == null || value === "") {
      throw new Error(`Missing path parameter ${name}`);
    }
    return encodeURIComponent(String(value));
  });
  const url = new URL(base.replace(/\/$/, "") + resolved);
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, typeof value === "string" ? value : String(value));
  }
  return url;
}

export function authHeaders(apiKey) {
  return {
    "x-api-key": apiKey,
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
    "user-agent": `fetchproof-mcp/${PACKAGE_VERSION}`,
  };
}

export async function callOperation({
  base,
  apiKey,
  method,
  path,
  params,
  timeoutMs = 60_000,
  fetchImpl = fetch,
}) {
  const url = requestUrl(base, path, params);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: method.toUpperCase(),
      headers: authHeaders(apiKey),
      signal: ac.signal,
    });
    const text = await res.text();
    let body = text;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return { status: res.status, body };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { status: 504, body: { success: false, error: "The Fetchproof request timed out.", credits_charged: 0 } };
    }
    return { status: 502, body: { success: false, error: `Fetchproof request failed: ${error?.message || error}`, credits_charged: 0 } };
  } finally {
    clearTimeout(timer);
  }
}
