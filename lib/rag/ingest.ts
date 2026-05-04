import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { CorpusConfig, CorpusFile, Visibility } from "@/corpus.config";
import { embedding as embeddingTable } from "@/lib/db/schema";
import { type Chunk, chunkMarkdown } from "./chunk";
import { embedTextsCached, sha256 } from "./embed";
import { type RedactStats, redactPii } from "./redact";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

export type ResolvedFile = {
  absolutePath: string;
  relativePath: string;
  visibility: Visibility;
  publicUrl?: string;
  matchedRule?: string;
};

export type IngestReport = {
  scanned: number;
  ingested: number;
  excluded: number;
  unclassified: string[];
  perFile: Array<{
    path: string;
    visibility: Visibility;
    chunks: number;
    redactions: RedactStats;
    embeddingHits: number;
    embeddingMisses: number;
  }>;
  removed: number;
};

/**
 * Glob-ish matcher: supports `*` (single segment) and `**` (any segments).
 * Sufficient for the patterns we use in `corpus.config.ts`; no need for a dep.
 */
export function matchPattern(pattern: string, path: string): boolean {
  const normalized = path.split(sep).join("/");
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLESTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLESTAR::/g, ".*");
  return new RegExp(`^${escaped}$`).test(normalized);
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  };
  await visit(root);
  return out;
}

export function classifyFile(
  relativePath: string,
  config: CorpusConfig
): { rule: CorpusFile | null; visibility: Visibility } {
  // Exact-path entries take precedence over glob entries; first match wins
  // within each tier so the config order is deterministic.
  const exact = config.files.find((f) => f.path === relativePath);
  if (exact) {
    return { rule: exact, visibility: exact.visibility };
  }
  const glob = config.files.find(
    (f) => f.path.includes("*") && matchPattern(f.path, relativePath)
  );
  if (glob) {
    return { rule: glob, visibility: glob.visibility };
  }
  return {
    rule: null,
    visibility: config.denyByDefault ? "exclude" : "private",
  };
}

/**
 * Convert linkedin-style `===\nTitle\n===` separators into `## Title` so the
 * heading-based chunker has structure to work with. No-op for files that
 * don't use that pattern.
 */
function normalizePlainText(content: string): string {
  return content.replace(
    /={6,}\n([^\n]+)\n={6,}/g,
    (_match, title: string) => `## ${title.trim()}`
  );
}

async function extractText(absolutePath: string): Promise<string> {
  const ext = extname(absolutePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file type for ${absolutePath}: only .md and .txt are ingested.`
    );
  }
  const raw = await readFile(absolutePath, "utf8");
  return ext === ".txt" ? normalizePlainText(raw) : raw;
}

export type ResolveOptions = {
  corpusPath: string;
  config: CorpusConfig;
};

export async function resolveCorpus(
  opts: ResolveOptions
): Promise<{ files: ResolvedFile[]; unclassified: string[] }> {
  const { corpusPath, config } = opts;
  const all = await walk(corpusPath);
  const files: ResolvedFile[] = [];
  const unclassified: string[] = [];

  for (const absolutePath of all) {
    const relativePath = relative(corpusPath, absolutePath)
      .split(sep)
      .join("/");
    const ext = extname(absolutePath).toLowerCase();

    // Silently skip unsupported types (PDFs, images) — corpus.config either
    // excludes them explicitly or this pipeline simply doesn't handle them.
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      continue;
    }

    const { rule, visibility } = classifyFile(relativePath, config);

    // Surface unclassified-but-supported files so future additions are noticed.
    if (!rule) {
      unclassified.push(relativePath);
    }

    if (visibility === "exclude") {
      continue;
    }

    files.push({
      absolutePath,
      relativePath,
      visibility,
      publicUrl: rule?.publicUrl,
      matchedRule: rule?.path,
    });
  }

  return { files, unclassified };
}

type IngestRunOptions = {
  corpusPath: string;
  config: CorpusConfig;
  /** Override the default Postgres connection (for tests). */
  connectionString?: string;
};

export async function runIngest(opts: IngestRunOptions): Promise<IngestReport> {
  const connectionString = opts.connectionString ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL is required for ingest (or pass connectionString)."
    );
  }

  const { files, unclassified } = await resolveCorpus({
    corpusPath: opts.corpusPath,
    config: opts.config,
  });

  const client = postgres(connectionString);
  const db = drizzle(client);

  const report: IngestReport = {
    scanned: files.length + unclassified.length,
    ingested: 0,
    excluded: 0,
    unclassified,
    perFile: [],
    removed: 0,
  };

  // Track which sources we touched so we can prune any rows for sources that
  // are no longer ingested (file removed from corpus, or visibility flipped).
  const seenSources = new Set<string>();

  try {
    for (const file of files) {
      const raw = await extractText(file.absolutePath);
      const { text, stats } = redactPii(raw);
      const chunks: Chunk[] = chunkMarkdown(text, file.relativePath).map(
        (c) => ({
          ...c,
          metadata: {
            ...c.metadata,
            publicUrl: file.publicUrl ?? c.metadata.publicUrl,
          },
        })
      );

      if (chunks.length === 0) {
        report.perFile.push({
          path: file.relativePath,
          visibility: file.visibility,
          chunks: 0,
          redactions: stats,
          embeddingHits: 0,
          embeddingMisses: 0,
        });
        continue;
      }

      const { embeddings, hits, misses } = await embedTextsCached(
        chunks.map((c) => c.content)
      );

      // Replace-by-source: deleting then inserting keeps idempotency simple,
      // including when a file has fewer chunks than a prior ingest run.
      await db.transaction(async (tx) => {
        await tx
          .delete(embeddingTable)
          .where(eq(embeddingTable.sourcePath, file.relativePath));

        await tx.insert(embeddingTable).values(
          chunks.map((chunk, i) => ({
            sourcePath: chunk.sourcePath,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            contentHash: sha256(chunk.content),
            embedding: embeddings[i],
            metadata: chunk.metadata,
            public: file.visibility === "public",
          }))
        );
      });

      seenSources.add(file.relativePath);
      report.ingested++;
      report.perFile.push({
        path: file.relativePath,
        visibility: file.visibility,
        chunks: chunks.length,
        redactions: stats,
        embeddingHits: hits,
        embeddingMisses: misses,
      });
    }

    // Prune sources that exist in the DB but weren't seen this run.
    const allSources = await db
      .selectDistinct({ sourcePath: embeddingTable.sourcePath })
      .from(embeddingTable);
    const stale = allSources
      .map((r) => r.sourcePath)
      .filter((s) => !seenSources.has(s));
    if (stale.length > 0) {
      const deleted = await db
        .delete(embeddingTable)
        .where(inArray(embeddingTable.sourcePath, stale))
        .returning({ id: embeddingTable.id });
      report.removed = deleted.length;
    }
  } finally {
    await client.end({ timeout: 5 });
  }

  return report;
}

export function formatReport(report: IngestReport): string {
  const lines: string[] = [];
  lines.push(`Scanned ${report.scanned} files`);
  lines.push(`  Ingested: ${report.ingested}`);
  lines.push(`  Removed (stale sources): ${report.removed}`);
  if (report.unclassified.length > 0) {
    lines.push(
      `  Unclassified (${report.unclassified.length}): add to corpus.config.ts to ingest`
    );
    for (const u of report.unclassified) {
      lines.push(`    - ${u}`);
    }
  }
  for (const f of report.perFile) {
    const r = f.redactions;
    const redacted = r.emails + r.phones + r.addresses;
    lines.push(
      `  ${f.path} [${f.visibility}] — ${f.chunks} chunks, ${f.embeddingHits} cached / ${f.embeddingMisses} new${
        redacted > 0
          ? `, redacted ${r.emails}e/${r.phones}p/${r.addresses}a`
          : ""
      }`
    );
  }
  return lines.join("\n");
}
