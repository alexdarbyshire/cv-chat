/**
 * Resume claim provenance validator (SPEC §3.8 truth methodology).
 *
 * Each claim in the generated resume carries `provenance: { sourcePath,
 * headingPath }`. After generation we cross-check each claim's provenance
 * against the (sourcePath, headingPath) pairs of the chunks that actually
 * fed the LLM. If a claim cites a chunk that wasn't retrieved, the LLM
 * invented its source — and almost certainly its content too.
 *
 * Two modes (set via `RESUME_PROVENANCE_MODE`, default `lenient`):
 *
 * - **lenient** (default for canonical deployment): drop offending claims
 *   silently and continue. The downstream bounds validator decides whether
 *   the trimmed resume still satisfies "at least one highlight, at least
 *   one bullet per role" — if not, the pipeline retries.
 *
 * - **strict** (fork knob): treat invented provenance as a generation
 *   failure and surface it; the caller can retry with feedback or fail.
 */

import type { SearchHit } from "@/lib/rag/search";
import type { RawResumeContent, ResumeContent } from "./schema";

export type ProvenanceMode = "lenient" | "strict";

export function provenanceMode(): ProvenanceMode {
  const raw = process.env.RESUME_PROVENANCE_MODE?.trim().toLowerCase();
  return raw === "strict" ? "strict" : "lenient";
}

export type InventedClaim = {
  /** Where in the resume the offending claim sits (e.g. `highlights[2]` or `roles[0].bullets[1]`). */
  location: string;
  text: string;
  provenance: { sourcePath: string; headingPath: string };
};

export type ProvenanceCheckResult = {
  /** True iff every claim's provenance matched a retrieved chunk. */
  ok: boolean;
  invented: InventedClaim[];
};

/**
 * Build a Set keyed by `${sourcePath}${headingPath}` (NUL-byte separator
 * keeps it unambiguous if either field contains `:` or `>` characters from
 * the heading path).
 */
function buildAllowedSet(hits: readonly SearchHit[]): Set<string> {
  const set = new Set<string>();
  for (const hit of hits) {
    if (hit.headingPath) {
      set.add(`${hit.sourcePath}${hit.headingPath}`);
    }
    // Some chunks have no headingPath (front-matter, top-of-file). Allow the
    // LLM to cite those by sourcePath alone with an empty headingPath.
    set.add(`${hit.sourcePath}`);
  }
  return set;
}

function isProvenanceAllowed(
  prov: { sourcePath: string; headingPath: string },
  allowed: Set<string>
): boolean {
  if (allowed.has(`${prov.sourcePath}${prov.headingPath}`)) {
    return true;
  }
  // Tolerate a model that drops the headingPath when the chunk had one — we
  // only require the sourcePath to be in the retrieved set.
  return allowed.has(`${prov.sourcePath}`);
}

/**
 * Cross-check every claim's provenance against the retrieved chunks. Returns
 * the offending claims (if any) without mutating the content. Use
 * `stripInventedClaims` (below) to apply lenient-mode trimming.
 */
export function validateResumeProvenance(
  content: ResumeContent | RawResumeContent,
  hits: readonly SearchHit[]
): ProvenanceCheckResult {
  const allowed = buildAllowedSet(hits);
  const invented: InventedClaim[] = [];

  content.highlights.forEach((claim, i) => {
    if (!isProvenanceAllowed(claim.provenance, allowed)) {
      invented.push({
        location: `highlights[${i}]`,
        text: claim.text,
        provenance: claim.provenance,
      });
    }
  });

  content.roles.forEach((role, i) => {
    role.bullets.forEach((claim, j) => {
      if (!isProvenanceAllowed(claim.provenance, allowed)) {
        invented.push({
          location: `roles[${i}].bullets[${j}]`,
          text: claim.text,
          provenance: claim.provenance,
        });
      }
    });
  });

  return { ok: invented.length === 0, invented };
}

/**
 * Lenient-mode trimmer: drops every claim flagged by the validator. The
 * caller should re-run `validateResumeBounds` afterwards because removing
 * claims can drop a role's bullet count below the `≥ 1` floor.
 */
export function stripInventedClaims<T extends ResumeContent | RawResumeContent>(
  content: T,
  invented: readonly InventedClaim[]
): T {
  if (invented.length === 0) {
    return content;
  }
  const inventedSet = new Set(invented.map((i) => i.location));

  return {
    ...content,
    highlights: content.highlights.filter(
      (_claim, i) => !inventedSet.has(`highlights[${i}]`)
    ),
    roles: content.roles.map((role, i) => ({
      ...role,
      bullets: role.bullets.filter(
        (_claim, j) => !inventedSet.has(`roles[${i}].bullets[${j}]`)
      ),
    })),
  } as T;
}

/**
 * Render the invented-claim list as a feedback message for a model retry.
 * Used by strict-mode generation to tell the LLM exactly which sources it
 * fabricated, so it can rewrite from real chunks.
 */
export function inventionFeedback(invented: readonly InventedClaim[]): string {
  const lines = invented.map(
    (i) =>
      `- ${i.location} cited '${i.provenance.sourcePath}' / '${i.provenance.headingPath}' — that pair wasn't in the SOURCES I provided.`
  );
  return [
    "Some of the claims you wrote cite chunks that were not in the SOURCES I gave you. You cannot invent provenance — every claim must point back to a real chunk's sourcePath and headingPath.",
    "",
    "Offending claims:",
    ...lines,
    "",
    "Rewrite those claims using only chunks from the SOURCES list, or drop them. Return the full object.",
  ].join("\n");
}

/**
 * Light-weight log helper used by the generation pipeline. Emits a single
 * line to stderr with the `[resume-validator]` prefix referenced by the
 * dispatch (so live tests can grep dev-server stdout for it).
 */
export function logInventedClaims(
  invented: readonly InventedClaim[],
  context: { mode: ProvenanceMode; attempt: number }
): void {
  if (invented.length === 0) {
    return;
  }
  for (const i of invented) {
    console.warn(
      `[resume-validator] mode=${context.mode} attempt=${context.attempt} ${i.location} text=${JSON.stringify(i.text)} cited='${i.provenance.sourcePath}'/'${i.provenance.headingPath}'`
    );
  }
}

export function logCleanGeneration(context: {
  mode: ProvenanceMode;
  attempt: number;
  chunkCount: number;
  claimCount: number;
}): void {
  console.info(
    `[resume-validator] ok mode=${context.mode} attempt=${context.attempt} chunks=${context.chunkCount} claims=${context.claimCount}`
  );
}
