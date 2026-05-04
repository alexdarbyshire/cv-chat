/**
 * Whether the request arrived over HTTPS, accounting for reverse proxies.
 *
 * Used to derive `getToken({ secureCookie })` — Auth.js with `trustHost: true`
 * writes `__Secure-` prefixed cookies whenever `x-forwarded-proto` is `https`,
 * so the lookup must use the same signal. Keying off `NODE_ENV` instead causes
 * an auth redirect loop when serving dev over an HTTPS reverse proxy.
 */
export function isHttpsRequest(req: {
  headers: { get(name: string): string | null };
  url?: string;
  nextUrl?: { protocol: string };
}): boolean {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  if (req.nextUrl) {
    return req.nextUrl.protocol === "https:";
  }
  if (req.url) {
    return new URL(req.url).protocol === "https:";
  }
  return false;
}
