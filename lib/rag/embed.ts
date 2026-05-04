import "server-only";

import { createHash } from "node:crypto";
import { embedMany } from "ai";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { EMBEDDING_MODEL_ID } from "@/lib/constants";
import { embedding as embeddingTable } from "@/lib/db/schema";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Embed an array of strings via the AI Gateway. Returns vectors in input order.
 * `embedMany` auto-chunks for the provider's per-call limit.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL_ID,
    values: texts,
  });
  return embeddings;
}

export type CachedEmbedResult = {
  embeddings: number[][];
  hits: number;
  misses: number;
};

/**
 * Embed with a SHA256 content cache backed by the Embedding table.
 *
 * For each input, look up any prior embedding with the same contentHash —
 * embeddings are deterministic, so a hash hit is a safe reuse and saves a
 * gateway call. Duplicate inputs within a single batch only embed once.
 * Only the misses go to the API; vectors return in input order.
 *
 * The caller is still responsible for upserting rows after embedding (the
 * ingest pipeline does this with chunkIndex + sourcePath as the key).
 */
export async function embedTextsCached(
  texts: string[]
): Promise<CachedEmbedResult> {
  if (texts.length === 0) {
    return { embeddings: [], hits: 0, misses: 0 };
  }

  const hashes = texts.map(sha256);
  const uniqueHashes = Array.from(new Set(hashes));

  const existing = await db
    .select({
      contentHash: embeddingTable.contentHash,
      embedding: embeddingTable.embedding,
    })
    .from(embeddingTable)
    .where(inArray(embeddingTable.contentHash, uniqueHashes));

  const byHash = new Map<string, number[]>();
  for (const row of existing) {
    if (!byHash.has(row.contentHash)) {
      byHash.set(row.contentHash, row.embedding);
    }
  }

  // Collect distinct misses (dedupes duplicates in this batch too).
  const missingTexts: string[] = [];
  const queuedHashes = new Set<string>();
  for (let i = 0; i < texts.length; i++) {
    const h = hashes[i];
    if (!(byHash.has(h) || queuedHashes.has(h))) {
      queuedHashes.add(h);
      missingTexts.push(texts[i]);
    }
  }

  const fresh = await embedTexts(missingTexts);
  for (let i = 0; i < missingTexts.length; i++) {
    byHash.set(sha256(missingTexts[i]), fresh[i]);
  }

  const embeddings = hashes.map((h) => {
    const v = byHash.get(h);
    if (!v) {
      throw new Error(`Embedding missing for hash ${h}`);
    }
    return v;
  });

  return {
    embeddings,
    hits: texts.length - queuedHashes.size,
    misses: queuedHashes.size,
  };
}
