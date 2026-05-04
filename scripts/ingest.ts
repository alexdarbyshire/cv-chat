/**
 * Ingestion CLI — reads `$CORPUS_PATH`, walks for markdown / text / pdf,
 * chunks → embeds → upserts into pgvector. Phase 2.
 *
 * Skeleton only for now; the real pipeline lands when `lib/rag/` is built.
 */

import { stat } from "node:fs/promises";

async function main() {
  const corpusPath = process.env.CORPUS_PATH;

  if (!corpusPath) {
    console.error(
      "CORPUS_PATH is not set. Point it at a local path or git+ssh URL " +
        "to your private career corpus, then re-run `pnpm ingest`."
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
  console.log(
    "[ingest] Pipeline lands in Phase 2 (chunk → embed → upsert). " +
      "See SPEC.md §3.7."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
