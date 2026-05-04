ALTER TABLE "Embedding"
  ADD COLUMN IF NOT EXISTS "public" boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "Embedding_public_idx"
  ON "Embedding" ("public");
