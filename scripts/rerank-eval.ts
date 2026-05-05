/**
 * Rerank rollout-gate eval (SPEC §7 Phase 7, §6 risk register).
 *
 * For each fixture in `tests/rag/rerank-eval.fixtures.ts` the runner calls
 * `searchCareerHistory` twice — once with rerank disabled (pgvector kNN
 * order) and once with rerank enabled (Cohere cross-encoder) — and prints
 * the top-N chunks side-by-side. The output is markdown for a human
 * reviewer to grade before flipping `CV_CHAT_RERANK=on` on a fork.
 *
 * Each rerank-on fixture costs one Cohere API call. Don't run in CI.
 *
 * Usage:
 *   pnpm eval:rerank                    # run all fixtures, print to stdout
 *   pnpm eval:rerank > out.md           # capture
 *   EVAL_LIMIT=3 pnpm eval:rerank       # smoke test (first N)
 *   EVAL_TAG=before pnpm eval:rerank    # tags the heading for diffing
 *   EVAL_TOP_N=5 pnpm eval:rerank       # default 3 (matches chat tool)
 */

import { config as loadEnv } from "dotenv";
import { DEFAULT_K, searchCareerHistory } from "@/lib/rag/search";
import {
  type RerankFixture,
  rerankFixtures,
} from "@/tests/rag/rerank-eval.fixtures";

loadEnv({ path: ".env.local" });

type RowHit = {
  rank: number;
  sourcePath: string;
  headingPath?: string;
  distance: number;
  rerankScore?: number;
  preview: string;
};

type FixtureResult = {
  fixture: RerankFixture;
  off: RowHit[];
  on: RowHit[];
  msOff: number;
  msOn: number;
  error?: string;
};

const limit = process.env.EVAL_LIMIT
  ? Number.parseInt(process.env.EVAL_LIMIT, 10)
  : rerankFixtures.length;
const tag = process.env.EVAL_TAG ?? "eval";
const topN = process.env.EVAL_TOP_N
  ? Number.parseInt(process.env.EVAL_TOP_N, 10)
  : 3;

const PREVIEW_CHARS = 240;

function preview(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS
    ? `${flat.slice(0, PREVIEW_CHARS)}…`
    : flat;
}

async function runOne(fixture: RerankFixture): Promise<FixtureResult> {
  try {
    const tOff = Date.now();
    const offHits = await searchCareerHistory(fixture.query, {
      k: DEFAULT_K,
      isOwner: true,
      rerank: false,
      rerankTopN: topN,
    });
    const msOff = Date.now() - tOff;

    const tOn = Date.now();
    const onHits = await searchCareerHistory(fixture.query, {
      k: DEFAULT_K,
      isOwner: true,
      rerank: true,
      rerankTopN: topN,
    });
    const msOn = Date.now() - tOn;

    return {
      fixture,
      msOff,
      msOn,
      off: offHits.map((h, i) => ({
        rank: i + 1,
        sourcePath: h.sourcePath,
        headingPath: h.headingPath,
        distance: h.distance,
        rerankScore: h.rerankScore,
        preview: preview(h.content),
      })),
      on: onHits.map((h, i) => ({
        rank: i + 1,
        sourcePath: h.sourcePath,
        headingPath: h.headingPath,
        distance: h.distance,
        rerankScore: h.rerankScore,
        preview: preview(h.content),
      })),
    };
  } catch (error) {
    return {
      fixture,
      off: [],
      on: [],
      msOff: 0,
      msOn: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderHit(hit: RowHit): string {
  const heading = hit.headingPath ? ` — ${hit.headingPath}` : "";
  const score =
    hit.rerankScore === undefined
      ? `distance=${hit.distance.toFixed(3)}`
      : `rerank=${hit.rerankScore.toFixed(3)}, distance=${hit.distance.toFixed(3)}`;
  return [
    `${hit.rank}. \`${hit.sourcePath}\`${heading}`,
    `   _(${score})_`,
    `   > ${hit.preview}`,
  ].join("\n");
}

function renderResult(result: FixtureResult): string {
  if (result.error) {
    return [
      `### ${result.fixture.id} — \`${result.fixture.query}\``,
      "",
      `**ERROR:** ${result.error}`,
      "",
    ].join("\n");
  }

  const expectations = result.fixture.expectations
    .map((e) => `- ${e}`)
    .join("\n");
  const offBlock = result.off.length
    ? result.off.map(renderHit).join("\n")
    : "_(no hits)_";
  const onBlock = result.on.length
    ? result.on.map(renderHit).join("\n")
    : "_(no hits)_";

  return [
    `### ${result.fixture.id} — \`${result.fixture.query}\``,
    "",
    "**What good looks like:**",
    expectations,
    "",
    `**Rerank OFF (pgvector kNN, top ${topN}, ${result.msOff}ms):**`,
    "",
    offBlock,
    "",
    `**Rerank ON (Cohere cross-encoder, top ${topN}, ${result.msOn}ms):**`,
    "",
    onBlock,
    "",
  ].join("\n");
}

async function main() {
  if (!process.env.COHERE_API_KEY) {
    process.stderr.write(
      "[rerank-eval] COHERE_API_KEY unset — rerank-on column will fall back to pgvector order. Set the key for a meaningful eval.\n"
    );
  }

  const fixtures = rerankFixtures.slice(0, limit);
  process.stderr.write(
    `[rerank-eval] running ${fixtures.length} queries (top-${topN}, tag=${tag})\n`
  );

  const results: FixtureResult[] = [];
  for (const fixture of fixtures) {
    process.stderr.write(`[rerank-eval] ${fixture.id} … `);
    const result = await runOne(fixture);
    results.push(result);
    if (result.error) {
      process.stderr.write(`error: ${result.error}\n`);
    } else {
      process.stderr.write(`off=${result.msOff}ms on=${result.msOn}ms\n`);
    }
  }

  console.log(`# Rerank eval — ${tag}`);
  console.log("");
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Top-N: ${topN}`);
  console.log(
    `Cohere key: ${process.env.COHERE_API_KEY ? "present" : "missing (on=fallback)"}`
  );
  console.log("");
  for (const result of results) {
    console.log(renderResult(result));
  }
}

main().catch((error) => {
  process.stderr.write(`[rerank-eval] fatal: ${error.message}\n`);
  process.exit(1);
});
