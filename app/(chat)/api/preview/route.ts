import { LINK_PREVIEW_ALLOWED_HOSTS } from "@/corpus.config";

/**
 * Link-preview metadata fetcher (SPEC §3.1 Rule 3). The citation hover
 * popover hits this route with `?url=<chunk publicUrl>`; the route only
 * fetches og: tags from hosts on the corpus.config allowlist. Belt-and-
 * braces against a future poisoned chunk redirecting fetches to internal
 * URLs (a classic SSRF surface).
 *
 * Response: 200 with `{ title, description?, image? }` on success;
 * 404 for URLs whose host isn't on the allowlist (the popover degrades
 * to just the URL); 502 for upstream fetch failures.
 *
 * In-memory cache (per-instance), 1h TTL. The corpus is small and
 * request rate is modest — no need for Redis.
 */

const FETCH_TIMEOUT_MS = 3000;
const RESPONSE_CAP_BYTES = 50_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

export type PreviewMeta = {
  title?: string;
  description?: string;
  image?: string;
};

type CacheEntry = {
  data: PreviewMeta;
  expiresAt: number;
};

const previewCache = new Map<string, CacheEntry>();

/**
 * Lower-case hostname with any leading `www.` stripped. Empty string
 * for inputs that aren't valid URLs — caller treats that as a reject.
 */
export function normalizeHost(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * True when the URL's host is on the allowlist or is a subdomain of an
 * allowlisted host (e.g. `linkedin.com` matches `au.linkedin.com`).
 * Forks add hosts in `corpus.config.ts`.
 */
export function isHostAllowed(
  rawUrl: string,
  allowed: readonly string[] = LINK_PREVIEW_ALLOWED_HOSTS
): boolean {
  const host = normalizeHost(rawUrl);
  if (!host) {
    return false;
  }
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Strip wrapping quotes/whitespace from an og: meta value and clamp
 * length so a hostile site can't blow up the popover.
 */
function cleanMeta(raw: string | undefined, max: number): string | undefined {
  if (!raw) {
    return;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return;
  }
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Extract og: title/description/image from a chunk of HTML using a small
 * regex — we don't pull in a full DOM parser for this. The chunk is
 * already capped at RESPONSE_CAP_BYTES so worst-case work is bounded.
 *
 * Strategy: find every `<meta ...>` tag that mentions either `property=`
 * or `name=` matching one of our keys, then read its `content=`.
 * Falls back to `<title>` for the title.
 */
export function parseOgTags(html: string): PreviewMeta {
  const out: PreviewMeta = {};
  const metaRegex = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(metaRegex)) {
    const tag = match[0];
    const keyMatch = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (!(keyMatch && contentMatch)) {
      continue;
    }
    const key = keyMatch[1].toLowerCase();
    const value = contentMatch[1];
    if (key === "og:title" || key === "twitter:title") {
      out.title ??= cleanMeta(value, 200);
    } else if (key === "og:description" || key === "twitter:description") {
      out.description ??= cleanMeta(value, 400);
    } else if (key === "og:image" || key === "twitter:image") {
      out.image ??= cleanMeta(value, 1000);
    }
  }
  if (!out.title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    out.title = cleanMeta(titleMatch?.[1], 200);
  }
  return out;
}

/**
 * Fetch the URL and read up to RESPONSE_CAP_BYTES into a string. Larger
 * bodies are truncated rather than rejected — the og: tags live in the
 * `<head>` so the first 50KB nearly always carries them.
 */
async function fetchHeadHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // Some sites refuse a default Node UA; identify ourselves clearly.
      "User-Agent":
        "cv-chat link-preview (+https://github.com/alexdarbyshire/cv-chat)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`upstream ${res.status}`);
  }
  if (!res.body) {
    return "";
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    html += decoder.decode(value, { stream: true });
    if (total >= RESPONSE_CAP_BYTES) {
      reader.cancel().catch(() => {
        // Cancellation errors are noisy and not actionable here.
      });
      break;
    }
  }
  html += decoder.decode();
  return html;
}

/** Test seam: clear the in-memory cache between cases. */
export function _resetPreviewCacheForTests(): void {
  previewCache.clear();
}

export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return Response.json({ error: "missing url" }, { status: 400 });
  }
  if (!isHostAllowed(target)) {
    return Response.json({ error: "host not on allowlist" }, { status: 404 });
  }

  const now = Date.now();
  const cached = previewCache.get(target);
  if (cached && cached.expiresAt > now) {
    return Response.json(cached.data, {
      headers: { "X-Preview-Cache": "hit" },
    });
  }

  let data: PreviewMeta;
  try {
    const html = await fetchHeadHtml(target);
    data = parseOgTags(html);
  } catch (error) {
    console.warn(
      `[preview] fetch failed for ${target}: ${error instanceof Error ? error.message : String(error)}`
    );
    return Response.json({ error: "fetch failed" }, { status: 502 });
  }

  previewCache.set(target, { data, expiresAt: now + CACHE_TTL_MS });
  return Response.json(data, { headers: { "X-Preview-Cache": "miss" } });
}
