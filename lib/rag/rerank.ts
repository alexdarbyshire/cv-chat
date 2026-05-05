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
 * Provider: AI Gateway via `@ai-sdk/gateway` brokers Cohere rerank as of
 * AI SDK 6 (gateway ≥3.0.110). The same `AI_GATEWAY_API_KEY` that powers
 * chat and embeddings covers rerank — one key, unified billing and
 * observability. Default model: `cohere/rerank-v3.5`. Forks can pick
 * another from `GatewayRerankingModelId` (cohere/rerank-v4-fast/-pro,
 * voyage/rerank-2.5/-lite) by passing `model`.
 *
 * Mode toggle: `CV_CHAT_RERANK=on|off` (default `on`). The off path
 * skips the gateway call entirely, so a fork that doesn't want any
 * rerank cost can ship with `CV_CHAT_RERANK=off`.
 */

import { gateway, rerank } from "ai";
import type { SearchHit } from "./search";

export type RerankMode = "on" | "off";

/** Default — Cohere's flagship English-tuned cross-encoder. */
const DEFAULT_RERANK_MODEL = "cohere/rerank-v3.5";

/**
 * 5s ceiling — generous for a single-doc rerank but not so long that a
 * gateway blip stalls a chat request that has its own 60s budget. On
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
  /** Override the gateway rerank model id (default `cohere/rerank-v3.5`). */
  model?: string;
};

/**
 * Reorder `hits` by cross-encoder relevance to `query`. Optionally trim to
 * `topN` after reranking. Returns a new array; the original is untouched.
 *
 * The function never throws — gateway errors, timeouts, and the
 * `CV_CHAT_RERANK=off` toggle all produce the no-rerank fallback
 * (pgvector order preserved, sliced to `topN` if provided). Each
 * fallback emits a single `[reranker] …` line to stderr so dev/prod
 * logs surface the cause.
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

  try {
    const { ranking } = await rerank({
      model: gateway.rerankingModel(opts.model ?? DEFAULT_RERANK_MODEL),
      query,
      documents: hits.map((h) => h.content),
      topN: topN ?? hits.length,
      abortSignal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    });

    const reordered = ranking
      .filter((r) => r.originalIndex >= 0 && r.originalIndex < hits.length)
      .map((r) => ({
        ...hits[r.originalIndex],
        rerankScore: r.score,
      }));
    return slice(reordered);
  } catch (error) {
    console.warn(
      `[reranker] failed, falling back to no-rerank: ${error instanceof Error ? error.message : String(error)}`
    );
    return slice(hits);
  }
}
