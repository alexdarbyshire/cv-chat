/**
 * Warmth eval runner (SPEC §7 Phase 7).
 *
 * Runs each fixture in `tests/persona/warmth-eval.fixtures.ts` through the
 * production chat model with the live persona system prompt and prints the
 * answer for human grading. No automated assertions — the eval is for
 * before/after qualitative review.
 *
 * Usage:
 *   pnpm eval:warmth                     # write markdown report to stdout
 *   pnpm eval:warmth > out.md            # capture
 *   EVAL_LIMIT=3 pnpm eval:warmth        # first N queries (smoke run)
 *   EVAL_TAG=before pnpm eval:warmth     # tags the heading for diffing
 *
 * Tools are intentionally NOT wired here. The point is to grade tone and
 * grounding behaviour from the persona prompt alone; tool-call discipline is
 * already covered by the dispatch's expectations and the live screenshots.
 */

import { generateText } from "ai";
import { config as loadEnv } from "dotenv";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { personaSystemPrompt } from "@/lib/persona";
import {
  type WarmthFixture,
  warmthFixtures,
} from "@/tests/persona/warmth-eval.fixtures";

loadEnv({ path: ".env.local" });

type EvalRow = {
  fixture: WarmthFixture;
  response: string;
  ms: number;
  error?: string;
};

const limit = process.env.EVAL_LIMIT
  ? Number.parseInt(process.env.EVAL_LIMIT, 10)
  : warmthFixtures.length;
const tag = process.env.EVAL_TAG ?? "eval";
const modelId = process.env.EVAL_MODEL ?? DEFAULT_CHAT_MODEL;

async function runOne(fixture: WarmthFixture): Promise<EvalRow> {
  const start = Date.now();
  try {
    const result = await generateText({
      model: getLanguageModel(modelId),
      system: personaSystemPrompt(),
      prompt: fixture.query,
      maxOutputTokens: 600,
    });
    return {
      fixture,
      response: result.text,
      ms: Date.now() - start,
    };
  } catch (error) {
    return {
      fixture,
      response: "",
      ms: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderRow(row: EvalRow): string {
  const expectations = row.fixture.expectations
    .map((e) => `  - ${e}`)
    .join("\n");
  const body = row.error
    ? `**ERROR:** ${row.error}`
    : row.response.trim() || "_(empty response)_";
  return [
    `### ${row.fixture.id} — \`${row.fixture.query}\``,
    "",
    "**Expectations:**",
    expectations,
    "",
    `**Response (${row.ms}ms, ${modelId}):**`,
    "",
    "```",
    body,
    "```",
    "",
  ].join("\n");
}

async function main() {
  const fixtures = warmthFixtures.slice(0, limit);
  process.stderr.write(
    `[warmth-eval] running ${fixtures.length} queries against ${modelId} (tag=${tag})\n`
  );

  const rows: EvalRow[] = [];
  for (const fixture of fixtures) {
    process.stderr.write(`[warmth-eval] ${fixture.id} … `);
    const row = await runOne(fixture);
    rows.push(row);
    process.stderr.write(
      row.error ? `error after ${row.ms}ms\n` : `${row.ms}ms\n`
    );
  }

  console.log(`# Warmth eval — ${tag}`);
  console.log("");
  console.log(`Model: \`${modelId}\``);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log("");
  for (const row of rows) {
    console.log(renderRow(row));
  }
}

main().catch((error) => {
  process.stderr.write(`[warmth-eval] fatal: ${error.message}\n`);
  process.exit(1);
});
