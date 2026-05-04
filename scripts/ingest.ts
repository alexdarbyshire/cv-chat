/**
 * Ingestion CLI — reads `$CORPUS_PATH`, walks for markdown / text,
 * chunks → redacts PII → embeds → upserts into pgvector.
 *
 * Pipeline lives in `lib/rag/ingest.ts`. This file is just argument parsing
 * and reporting.
 */

import { stat } from "node:fs/promises";
import { config as loadEnv } from "dotenv";
import { corpusConfig } from "@/corpus.config";
import { formatReport, runIngest } from "@/lib/rag/ingest";

loadEnv({ path: ".env.local" });

async function main() {
  const corpusPath = process.env.CORPUS_PATH;

  if (!corpusPath) {
    console.error(
      "CORPUS_PATH is not set. Point it at a local path (e.g. ~/git/career) and re-run `pnpm ingest`."
    );
    process.exit(1);
  }

  try {
    const info = await stat(corpusPath);
    if (!info.isDirectory()) {
      console.error(`CORPUS_PATH is not a directory: ${corpusPath}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(
      `Cannot read CORPUS_PATH=${corpusPath}: ${(err as Error).message}`
    );
    process.exit(1);
  }

  console.log(`[ingest] CORPUS_PATH=${corpusPath}`);

  const report = await runIngest({
    corpusPath,
    config: corpusConfig,
  });

  console.log(formatReport(report));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
