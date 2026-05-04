/**
 * Resume groundedness eval runner (SPEC §3.8 truth methodology).
 *
 * For each fixture in `tests/resume/groundedness.fixtures.ts` the runner
 * actually exercises the resume pipeline — real retrieval, real LLM call,
 * real provenance validation. Each fixture costs an LLM call (sometimes
 * more if the model needs a bounds retry), so don't run this in CI. Use
 * it on PRs that touch resume code, retrieval, or persona prompts.
 *
 * Usage:
 *   pnpm eval:resume                        # run all fixtures, print to stdout
 *   pnpm eval:resume > out.md               # capture
 *   EVAL_LIMIT=3 pnpm eval:resume           # smoke test (first N)
 *   EVAL_TAG=after pnpm eval:resume         # tags the heading
 *   RESUME_PROVENANCE_MODE=strict pnpm eval:resume
 *
 * Output is markdown: per-fixture brief, claim+provenance pairs, allowed-
 * path matches, scope-widening flags, and any dropped claims surfaced by
 * the lenient validator.
 */

import { config as loadEnv } from "dotenv";
import { generateTailoredResume } from "@/lib/resume/generate";
import {
  type GroundednessFixture,
  groundednessFixtures,
} from "@/tests/resume/groundedness.fixtures";

loadEnv({ path: ".env.local" });

type ClaimRow = {
  location: string;
  text: string;
  provenance: { sourcePath: string; headingPath: string };
};

type FixtureResult = {
  fixture: GroundednessFixture;
  ms: number;
  attempts: number;
  modelId: string;
  claims: ClaimRow[];
  droppedClaims: ClaimRow[];
  allowedHits: number;
  allowedMisses: ClaimRow[];
  scopeWideningFlags: { rule: string; claim: ClaimRow }[];
  error?: string;
};

const limit = process.env.EVAL_LIMIT
  ? Number.parseInt(process.env.EVAL_LIMIT, 10)
  : groundednessFixtures.length;
const tag = process.env.EVAL_TAG ?? "eval";
const modelId = process.env.CV_CHAT_RESUME_MODEL ?? "(default)";
const mode =
  process.env.RESUME_PROVENANCE_MODE?.toLowerCase() === "strict"
    ? "strict"
    : "lenient";

function collectClaims(content: {
  highlights:
    | ClaimRow[]
    | {
        text: string;
        provenance: { sourcePath: string; headingPath: string };
      }[];
  roles: {
    bullets: {
      text: string;
      provenance: { sourcePath: string; headingPath: string };
    }[];
  }[];
}): ClaimRow[] {
  const rows: ClaimRow[] = [];
  content.highlights.forEach((c, i) => {
    rows.push({
      location: `highlights[${i}]`,
      text: (c as ClaimRow).text,
      provenance: (c as ClaimRow).provenance,
    });
  });
  content.roles.forEach((role, i) => {
    role.bullets.forEach((c, j) => {
      rows.push({
        location: `roles[${i}].bullets[${j}]`,
        text: c.text,
        provenance: c.provenance,
      });
    });
  });
  return rows;
}

function checkAllowedPaths(
  claims: ClaimRow[],
  patterns: RegExp[]
): { hits: number; misses: ClaimRow[] } {
  if (patterns.length === 0) {
    return { hits: claims.length, misses: [] };
  }
  let hits = 0;
  const misses: ClaimRow[] = [];
  for (const claim of claims) {
    const haystack = `${claim.provenance.sourcePath} ${claim.provenance.headingPath}`;
    if (patterns.some((p) => p.test(haystack))) {
      hits++;
    } else {
      misses.push(claim);
    }
  }
  return { hits, misses };
}

function checkScopeWidening(
  claims: ClaimRow[],
  rules: { from: RegExp; to: RegExp }[]
): { rule: string; claim: ClaimRow }[] {
  const flags: { rule: string; claim: ClaimRow }[] = [];
  for (const rule of rules) {
    for (const claim of claims) {
      const sourceHaystack = `${claim.provenance.sourcePath} ${claim.provenance.headingPath}`;
      if (rule.from.test(sourceHaystack) && rule.to.test(claim.text)) {
        flags.push({
          rule: `${String(rule.from)} → ${String(rule.to)}`,
          claim,
        });
      }
    }
  }
  return flags;
}

async function runOne(fixture: GroundednessFixture): Promise<FixtureResult> {
  const start = Date.now();
  try {
    const result = await generateTailoredResume({
      brief: {
        roleFocus: fixture.roleFocus,
        emphasis: [...fixture.emphasis],
      },
    });
    const claims = collectClaims(result.content);
    const dropped = result.droppedClaims.map((c) => ({
      location: c.location,
      text: c.text,
      provenance: c.provenance,
    }));
    const allowed = checkAllowedPaths(claims, fixture.allowedHeadingPaths);
    const scopeFlags = checkScopeWidening(
      claims,
      fixture.forbiddenScopeWidening
    );
    return {
      fixture,
      ms: Date.now() - start,
      attempts: result.attempts,
      modelId,
      claims,
      droppedClaims: dropped,
      allowedHits: allowed.hits,
      allowedMisses: allowed.misses,
      scopeWideningFlags: scopeFlags,
    };
  } catch (error) {
    return {
      fixture,
      ms: Date.now() - start,
      attempts: 0,
      modelId,
      claims: [],
      droppedClaims: [],
      allowedHits: 0,
      allowedMisses: [],
      scopeWideningFlags: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderClaim(c: ClaimRow): string {
  const path = c.provenance.headingPath || "(top-of-file)";
  return `  - **${c.location}** _(${c.provenance.sourcePath} · ${path})_  \n    ${c.text}`;
}

function renderRow(row: FixtureResult): string {
  const lines: string[] = [
    `### ${row.fixture.id} — \`${row.fixture.roleFocus}\``,
    "",
    `Emphasis: ${row.fixture.emphasis.map((e) => `\`${e}\``).join(", ")}  `,
    `Time: ${row.ms}ms · attempts: ${row.attempts} · model: \`${row.modelId}\``,
    "",
  ];

  if (row.error) {
    lines.push(`**ERROR:** ${row.error}`, "");
    return lines.join("\n");
  }

  lines.push(`**Claims (${row.claims.length}):**`);
  for (const c of row.claims) {
    lines.push(renderClaim(c));
  }
  lines.push("");

  if (row.droppedClaims.length > 0) {
    lines.push(
      `**Dropped by lenient validator (${row.droppedClaims.length}):**`
    );
    for (const c of row.droppedClaims) {
      lines.push(renderClaim(c));
    }
    lines.push("");
  }

  lines.push(
    `**Allowed-path coverage:** ${row.allowedHits}/${row.claims.length} claims matched expected sources.`
  );
  if (row.allowedMisses.length > 0) {
    lines.push(
      "**Off-pattern claims (review for scope drift, not a hard fail):**"
    );
    for (const c of row.allowedMisses) {
      lines.push(renderClaim(c));
    }
  }
  lines.push("");

  if (row.scopeWideningFlags.length > 0) {
    lines.push(`**Scope-widening flags (${row.scopeWideningFlags.length}):**`);
    for (const f of row.scopeWideningFlags) {
      lines.push(`  - rule \`${f.rule}\` matched \`${f.claim.location}\``);
      lines.push(`    text: ${f.claim.text}`);
      lines.push(
        `    cited: ${f.claim.provenance.sourcePath} / ${f.claim.provenance.headingPath}`
      );
    }
    lines.push("");
  } else {
    lines.push("**Scope-widening flags:** none.", "");
  }

  return lines.join("\n");
}

async function main() {
  const fixtures = groundednessFixtures.slice(0, limit);
  process.stderr.write(
    `[resume-eval] running ${fixtures.length} fixtures (mode=${mode}, model=${modelId}, tag=${tag})\n`
  );

  const rows: FixtureResult[] = [];
  for (const fixture of fixtures) {
    process.stderr.write(`[resume-eval] ${fixture.id} … `);
    const row = await runOne(fixture);
    rows.push(row);
    process.stderr.write(
      row.error
        ? `error after ${row.ms}ms\n`
        : `${row.ms}ms (attempts=${row.attempts}, claims=${row.claims.length}, dropped=${row.droppedClaims.length}, scope-flags=${row.scopeWideningFlags.length})\n`
    );
  }

  const errored = rows.filter((r) => r.error).length;
  const totalClaims = rows.reduce((acc, r) => acc + r.claims.length, 0);
  const totalDropped = rows.reduce((acc, r) => acc + r.droppedClaims.length, 0);
  const totalScope = rows.reduce(
    (acc, r) => acc + r.scopeWideningFlags.length,
    0
  );

  console.log(`# Resume groundedness eval — ${tag}`);
  console.log("");
  console.log(`Mode: \`${mode}\` · Model: \`${modelId}\``);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(
    `Fixtures: ${fixtures.length} · errored: ${errored} · total claims: ${totalClaims} · dropped: ${totalDropped} · scope flags: ${totalScope}`
  );
  console.log("");
  for (const row of rows) {
    console.log(renderRow(row));
  }
}

main()
  .catch((error) => {
    process.stderr.write(`[resume-eval] fatal: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    // The retrieval module opens a long-lived postgres pool. Force exit so
    // the script doesn't hang after the report is written.
    process.exit(process.exitCode ?? 0);
  });
