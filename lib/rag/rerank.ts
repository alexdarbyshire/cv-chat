/**
 * Cross-encoder reranker (SPEC §7 Phase 7).
 *
 * pgvector kNN gets us a noisy top-k by cosine similarity to the query
 * embedding. A cross-encoder rerank scores (query, document) pairs jointly
 * and tends to surface the chunk that *answers* the question, not just the
 * chunk closest in embedding space. Worth ~1 extra HTTP round-trip and a
 * few cents per million tokens for a measurable lift on overlapping-topic
 * questions ("tell me about your Azure work AND your team-leadership
 * experience" — embedding cosine pulls in both topics; rerank weights
 * what's actually relevant).
 *
 * Provider: Cohere Rerank v2 via direct HTTPS. The Vercel AI Gateway
 * brokers Cohere's LLMs and embeddings but not their rerank endpoint
 * (yet), so we hit `api.cohere.com/v2/rerank` directly. Configure with
 * `COHERE_API_KEY`; without a key the function falls through to a no-op
 * (returns hits in pgvector order). Same fallback on HTTP errors —
 * never error the request.
 *
 * Mode toggle: `CV_CHAT_RERANK=on|off` (default `on`). The off path
 * doesn't make any HTTP call, so a fork that doesn't want to integrate
 * Cohere can ship with `CV_CHAT_RERANK=off` and pay zero rerank cost.
 */

import type { SearchHit } from "./search";

export type RerankMode = "on" | "off";

const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";
/** Cohere's flagship English-tuned rerank model as of 2025-11. */
const COHERE_RERANK_MODEL = "rerank-v3.5";

/**
 * 5s ceiling — generous for a single-doc rerank but not so long that a
 * Cohere blip stalls a chat request that has its own 60s budget. On
 * timeout we fall through to pgvector order.
 */
const RERANK_TIMEOUT_MS = 5000;

export function rerankMode(): RerankMode {
  const raw = process.env.CV_CHAT_RERANK?.trim().toLowerCase();
  return raw === "off" ? "off" : "on";
}

export type RerankOptions = {
  /** Override `CV_CHAT_RERANK`. Pass `false` to skip the rerank call entirely. */
  enabled?: boolean;
  /** Trim to this many hits after rerank. Defaults to all of `hits`. */
  topN?: number;
  /** Override the Cohere model id (forks may pin to a specific version). */
  model?: string;
};

type CohereRerankResponse = {
  results?: { index: number; relevance_score: number }[];
};

/**
 * Reorder `hits` by cross-encoder relevance to `query`. Optionally trim to
 * `topN` after reranking. Returns a new array; the original is untouched.
 *
 * The function never throws — auth failures, network errors, and a missing
 * `COHERE_API_KEY` all produce the no-rerank fallback (pgvector order
 * preserved, sliced to `topN` if provided). Each fallback emits a single
 * `[reranker] …` line to stderr so dev/prod logs surface the cause.
 */
export async function rerankHits(
  query: string,
  hits: readonly SearchHit[],
  opts: RerankOptions = {}
): Promise<SearchHit[]> {
  const enabled = opts.enabled ?? rerankMode() === "on";
  const topN = opts.topN;
  const slice = (xs: readonly SearchHit[]) =>
    topN === undefined ? [...xs] : xs.slice(0, topN);

  if (!enabled) {
    return slice(hits);
  }
  if (hits.length === 0) {
    return [];
  }
  const apiKey = process.env.COHERE_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[reranker] no provider configured (COHERE_API_KEY unset), falling back to no-rerank"
    );
    return slice(hits);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);
  try {
    const res = await fetch(COHERE_RERANK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model ?? COHERE_RERANK_MODEL,
        query,
        documents: hits.map((h) => h.content),
        top_n: topN ?? hits.length,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`cohere rerank ${res.status}`);
    }
    const data = (await res.json()) as CohereRerankResponse;
    if (!Array.isArray(data.results)) {
      throw new Error("cohere rerank: malformed response (no results array)");
    }
    const reordered = data.results
      .filter((r) => r.index >= 0 && r.index < hits.length)
      .map((r) => ({
        ...hits[r.index],
        rerankScore: r.relevance_score,
      }));
    return slice(reordered);
  } catch (error) {
    console.warn(
      `[reranker] failed, falling back to no-rerank: ${error instanceof Error ? error.message : String(error)}`
    );
    return slice(hits);
  } finally {
    clearTimeout(timeout);
  }
}
