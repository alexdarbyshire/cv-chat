/**
 * Citation extraction (SPEC §3.1).
 *
 * The chat tool returns `chunks: [{ headingPath, sourcePath, publicUrl,
 * public, ... }]` per `searchCareerHistory` call. The renderer needs a
 * deduped, filtered list of citation chips that respect three rules:
 *
 *   1. Only chunks with a non-empty `publicUrl` get a chip — chunks
 *      without a canonical URL still inform the answer but don't render.
 *   2. Private chunks (`public === false`) only render for the deployment
 *      owner — defence-in-depth on top of the search-time SQL filter.
 *   3. The chunk's host must be on `LINK_PREVIEW_ALLOWED_HOSTS` — keeps
 *      a future poisoned chunk from redirecting the popover fetch
 *      anywhere unexpected.
 *
 * Deduped by `publicUrl` so a query that fired multiple search calls or
 * matched the same source twice doesn't render duplicate chips.
 */

import { isHostAllowed } from "@/app/(chat)/api/preview/route";
import { LINK_PREVIEW_ALLOWED_HOSTS } from "@/corpus.config";

export type CitationChunkInput = {
  publicUrl?: string;
  sourcePath?: string;
  headingPath?: string;
  public?: boolean;
};

export type Citation = {
  /** Canonical URL the chip links to. Always set. */
  url: string;
  /** Lower-case hostname (with `www.` stripped) — used for favicon + label. */
  host: string;
  /** Human-friendly label: prefer `headingPath`, else host. */
  label: string;
  /** Source file path; useful for `data-` attrs and debug tooling. */
  sourcePath?: string;
};

/**
 * Pull tool outputs out of a message-parts array. Each AI SDK message
 * `tool-searchCareerHistory` part with `state === "output-available"`
 * carries a `chunks` array — that's the citation source.
 *
 * Loosely typed because `ChatMessage["parts"]` is a discriminated union
 * we'd otherwise have to import + narrow; the shape we need is small
 * and stable enough that a structural check pays for itself.
 */
type ToolPart = {
  type?: string;
  state?: string;
  output?: { chunks?: unknown };
};

function extractChunks(
  parts: readonly unknown[]
): readonly CitationChunkInput[] {
  const out: CitationChunkInput[] = [];
  for (const raw of parts) {
    const part = raw as ToolPart;
    if (
      part?.type !== "tool-searchCareerHistory" ||
      part.state !== "output-available"
    ) {
      continue;
    }
    const chunks = part.output?.chunks;
    if (!Array.isArray(chunks)) {
      continue;
    }
    for (const chunk of chunks) {
      if (chunk && typeof chunk === "object") {
        out.push(chunk as CitationChunkInput);
      }
    }
  }
  return out;
}

function hostFor(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function eligibleCitations(
  chunks: readonly CitationChunkInput[],
  isOwner: boolean,
  allowedHosts: readonly string[] = LINK_PREVIEW_ALLOWED_HOSTS
): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const chunk of chunks) {
    const url = chunk.publicUrl?.trim();
    if (!url) {
      continue;
    }
    if (chunk.public === false && !isOwner) {
      continue;
    }
    if (!isHostAllowed(url, allowedHosts)) {
      continue;
    }
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    const host = hostFor(url);
    out.push({
      url,
      host,
      label: chunk.headingPath?.trim() || host,
      sourcePath: chunk.sourcePath,
    });
  }
  return out;
}

/**
 * Convenience wrapper: walk a message's `parts` (as the AI SDK shapes
 * them) and return the citation chips eligible to render.
 */
export function citationsFromMessageParts(
  parts: readonly unknown[] | undefined,
  isOwner: boolean,
  allowedHosts?: readonly string[]
): Citation[] {
  if (!parts) {
    return [];
  }
  return eligibleCitations(extractChunks(parts), isOwner, allowedHosts);
}
