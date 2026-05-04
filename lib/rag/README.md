# lib/rag

Chunking, embedding, and retrieval helpers for the career corpus.

Populated in **Phase 2** (RAG). For now this directory is a placeholder.

Planned modules:

- `chunk.ts` — split markdown by H2/H3 with token-bounded soft caps and overlap.
- `embed.ts` — batched OpenAI `text-embedding-3-small` calls with a `sha256(content)` cache.
- `retrieve.ts` — kNN over pgvector with the `public = true` filter applied at the SQL layer.

The `search_career_history` agent tool (under `lib/ai/tools/`) calls into these.
