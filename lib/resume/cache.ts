import { createHash } from "node:crypto";
import { list, put } from "@vercel/blob";
import { renderResume, TEMPLATE_VERSION } from "./render";
import type { ResumeJSON } from "./schema";

const BLOB_PREFIX = "resumes/";

/**
 * Stable JSON serialization with sorted keys. Object key order is normally
 * preserved by V8, but generateObject results pass through JSON.parse and
 * sometimes produce different orderings for the same logical content. Sort
 * to keep cache keys content-addressable rather than insertion-order
 * dependent.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalStringify(
        (value as Record<string, unknown>)[k]
      )}`
  );
  return `{${entries.join(",")}}`;
}

/**
 * sha256(canonicalJson + ":" + templateVersion). Same content + same template
 * version → same hash → same Blob URL. Bumping `TEMPLATE_VERSION` invalidates
 * the cache for everyone, which is what we want when the layout changes.
 */
export function cacheKey(json: ResumeJSON, templateVersion: string): string {
  const payload = `${canonicalStringify(json)}:${templateVersion}`;
  return createHash("sha256").update(payload).digest("hex");
}

export type CachedResumeResult = {
  url: string;
  cached: boolean;
};

/**
 * Look up a previously-rendered resume by content hash, or render+upload if
 * we haven't seen this exact content+template before. Same conversation
 * shape twice = byte-identical PDF, no regeneration cost.
 */
export async function getOrRenderResume(
  json: ResumeJSON
): Promise<CachedResumeResult> {
  const hash = cacheKey(json, TEMPLATE_VERSION);
  const pathname = `${BLOB_PREFIX}${hash}.pdf`;

  const existing = await list({ prefix: pathname, limit: 1 });
  const hit = existing.blobs.find((b) => b.pathname === pathname);
  if (hit) {
    return { url: hit.url, cached: true };
  }

  const bytes = await renderResume(json);
  const result = await put(pathname, bytes, {
    access: "public",
    contentType: "application/pdf",
    addRandomSuffix: false,
  });
  return { url: result.url, cached: false };
}
