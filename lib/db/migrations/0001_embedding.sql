CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "Embedding" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sourcePath" text NOT NULL,
  "chunkIndex" integer NOT NULL,
  "content" text NOT NULL,
  "contentHash" varchar(64) NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Embedding_source_chunk_uidx"
  ON "Embedding" ("sourcePath", "chunkIndex");

CREATE INDEX IF NOT EXISTS "Embedding_contentHash_idx"
  ON "Embedding" ("contentHash");

CREATE INDEX IF NOT EXISTS "Embedding_embedding_hnsw_idx"
  ON "Embedding" USING hnsw ("embedding" vector_cosine_ops);
