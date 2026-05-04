import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { embedding as embeddingTable } from "@/lib/db/schema";
import { embedTexts } from "./embed";

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
  distance: number;
};

export type SearchOptions = {
  k?: number;
  /** When true, include private chunks. Otherwise restrict to public=true. */
  isOwner?: boolean;
};

export const DEFAULT_K = 6;

/**
 * kNN over the Embedding table by cosine distance (pgvector `<=>`). Returns
 * the top-k nearest chunks the requester is allowed to see — public chunks
 * always, plus private when `isOwner` is true.
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
      distance,
    })
    .from(embeddingTable);

  const filtered = opts.isOwner
    ? builder
    : builder.where(eq(embeddingTable.public, true));

  const rows = await filtered.orderBy(distance).limit(k);

  return rows.map((row) => ({
    content: row.content,
    headingPath: row.metadata.title,
    sourcePath: row.sourcePath,
    publicUrl: row.metadata.publicUrl,
    distance: row.distance,
  }));
}
