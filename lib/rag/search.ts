import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { embedding as embeddingTable } from "@/lib/db/schema";
import { embedTexts } from "./embed";
import { rerankHits } from "./rerank";

// Lazy-init mirrors lib/rag/embed.ts: read POSTGRES_URL on first use so
// callers (Next routes, vitest) can load env before the connection opens.
let _db: ReturnType<typeof drizzle> | null = null;
function getDb() {
  if (!_db) {
    _db = drizzle(postgres(process.env.POSTGRES_URL ?? ""));
  }
  return _db;
}

export type SearchHit = {
  content: string;
  headingPath?: string;
  sourcePath: string;
  publicUrl?: string;
  /**
   * Visibility tier of the chunk's source file (corpus.config.ts). True for
   * public-tier chunks, false for private (owner-only) chunks. Surfaced so
   * the citation renderer can apply Rule 2 (defence-in-depth on top of the
   * SQL `WHERE public = true OR isOwner` filter, SPEC §3.1).
   */
  public: boolean;
  /** pgvector cosine distance (lower = closer). */
  distance: number;
  /** Cross-encoder relevance score (higher = more relevant). Set when the rerank pass runs. */
  rerankScore?: number;
};

export type SearchOptions = {
  /** pgvector candidate count (also the upper bound on returned hits). */
  k?: number;
  /** When true, include private chunks. Otherwise restrict to public=true. */
  isOwner?: boolean;
  /** Override `CV_CHAT_RERANK`; pass `false` to skip the rerank pass for this call. */
  rerank?: boolean;
  /** Trim to this many hits after rerank. Defaults to all of `k`. */
  rerankTopN?: number;
};

export const DEFAULT_K = 6;

/**
 * kNN over the Embedding table by cosine distance (pgvector `<=>`), then a
 * cross-encoder rerank pass (SPEC §7) when enabled. Returns the top-k
 * nearest chunks the requester is allowed to see — public chunks always,
 * plus private when `isOwner` is true. The chat tool sets `rerankTopN: 3`
 * to compress the candidate set per SPEC; the resume pipeline keeps the
 * default (rerank reorders all `k` without trimming).
 */
export async function searchCareerHistory(
  query: string,
  opts: SearchOptions = {}
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const k = opts.k ?? DEFAULT_K;

  const [vector] = await embedTexts([trimmed]);
  if (!vector) {
    return [];
  }
  // pgvector text-input format: [0.1,0.2,...]
  const vectorLiteral = `[${vector.join(",")}]`;
  const distance = sql<number>`${embeddingTable.embedding} <=> ${vectorLiteral}::vector`;

  const builder = getDb()
    .select({
      content: embeddingTable.content,
      sourcePath: embeddingTable.sourcePath,
      metadata: embeddingTable.metadata,
      public: embeddingTable.public,
      distance,
    })
    .from(embeddingTable);

  const filtered = opts.isOwner
    ? builder
    : builder.where(eq(embeddingTable.public, true));

  const rows = await filtered.orderBy(distance).limit(k);

  const candidates: SearchHit[] = rows.map((row) => ({
    content: row.content,
    headingPath: row.metadata.title,
    sourcePath: row.sourcePath,
    publicUrl: row.metadata.publicUrl,
    public: row.public,
    distance: row.distance,
  }));

  return rerankHits(trimmed, candidates, {
    enabled: opts.rerank,
    topN: opts.rerankTopN,
  });
}
