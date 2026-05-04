# cv-chat — Worker Instructions

You are working on **cv-chat**: a public, OSS-licensed (MIT), forkable chatbot
that answers questions about a user's career history using RAG.

## Project goals

1. **Reusable by other devs**. Anyone can fork, point at their own corpus, deploy. No `alex-`-prefixed identifiers; configuration lives in env vars and a single config file.
2. **Framework-first, idiomatic**. Use library implementations — never roll our own. shadcn/ui for components. AI SDK `tool()` and `ToolLoopAgent` for retrieval. Auth.js for auth. pgvector for embeddings. `next-themes` for theming. No bespoke wrappers around any of these unless absolutely required.
3. **Clean public commit history**. Every commit is meaningful and in the right shape for a public OSS project. No "fix typo", no "wip", no leaked secrets in history.
4. **Corpus privacy**. The career corpus is NEVER committed to this repo. Ingestion reads from an external source (private repo path / URL) and writes embeddings to Postgres.

## Stack (locked in)

- Next.js (App Router), TypeScript
- AI SDK (`ai` package) — `ToolLoopAgent` pattern
- shadcn/ui + Tailwind CSS
- Auth.js — Google OAuth + anonymous "guest" sessions
- Neon Postgres + pgvector
- Upstash Redis (rate limiting)
- Vercel deploy
- Default model: Claude Sonnet (via AI Gateway). Swappable via env.

## What lives where

- `app/` — Next.js routes (chat UI, auth, API routes including AI tool endpoints)
- `lib/ai/` — AI SDK setup, agent definition, tools (search, etc.)
- `lib/rag/` — chunking, embedding, retrieval helpers
- `lib/db/` — drizzle schema + migrations (chat history + embeddings tables)
- `lib/auth/` — Auth.js config (Google + guest)
- `lib/rate-limit/` — Upstash sliding-window rate limiter
- `scripts/ingest.ts` — reads corpus from `$CORPUS_PATH`, chunks, embeds, upserts
- `theme/` — CSS variables, font loading, single-file theme config
- `docs/` — SETUP.md, ARCHITECTURE.md, CONTRIBUTING.md
- `SPEC.md` — single source of truth for design decisions

## Coding rules

- **Server Components by default**. Client components only when interactivity demands it.
- **No prop drilling for theme**. CSS variables only.
- **No magic strings**. Model IDs, table names, tool names → `lib/constants.ts` or env.
- **Tool calls return structured data**. The AI SDK `tool()` schema is the contract. No string-parsing tool outputs.
- **Migrations are checked in**. Drizzle generates them; never edit by hand.
- **Tests**: Playwright for the chat happy-path, Vitest for `lib/rag/`. Don't pad coverage; cover what would silently break in prod.

## Quality gates (pre-commit)

Husky's `pre-commit` hook runs three checks, in order, on every commit:

1. **`pnpm exec ultracite check`** — Biome lint + format. Auto-fix locally with `pnpm fix` if it complains.
2. **`pnpm exec tsc --noEmit`** — full-project typecheck. `next build` does this too but is too slow to run mid-task.
3. **`pnpm exec knip`** — dead code, dead exports, unused dependencies. Config in `knip.json` already tolerates shadcn/ui and AI Elements vendor surfaces; *new* dead code is fair game.

Run any of these mid-task to check yourself before committing. A clean run on all three is the bar for opening a PR.

`pnpm test:unit` (Vitest) is **not** in the pre-commit chain — kept fast. Run it yourself when touching anything in `lib/` (especially `lib/auth/`, `lib/rag/`). CI runs the full set including Playwright.

**`--no-verify` policy**: do not bypass the pre-commit hook unless the user has explicitly authorized it for the current commit. The legitimate case is "I'm landing intentionally-partial state and the next commit completes it" (e.g. adding a function that the next commit will wire up). Anything else — fix the underlying problem, don't skip.

## Skills available to you

The following skills are committed to `.claude/skills/`:

- `vercel-ai-sdk` — official AI SDK skill (progressive disclosure)
- `react-best-practices` — Next.js perf/SSR patterns
- `web-design-guidelines` — accessibility + UX audit (use this when working on UI)
- `composition-patterns` — React composition (avoid boolean-prop sprawl)
- `vercel-deploy` — deployment helper

When you're working on something a skill covers, *use* it — don't reinvent.

## MCP servers (dev only)

Two MCP servers are wired in (see `.mcp.json`). Both require `pnpm dev` to be running.

- **`tidewave`** (HTTP, `/tidewave/mcp`) — runtime introspection of the live Next dev server. Prefer over manual investigation:
  - `project_eval` — run code in app context (resolve imports, hit the DB, test a function with real data) instead of writing a one-off script
  - `get_logs` — read server console output instead of scrolling the dev tab
  - `get_source_location` — jump to a symbol's file/line without grep
  - `get_docs` — installed-version-correct docs for any dependency
- **`next-devtools`** (stdio, Vercel's `next-devtools-mcp`) — Next 16-aware. **Call `init` once at the start of any Next-related task** to load the tool's own context. Then `nextjs_docs` for framework Q's, `nextjs_call` to talk to Next's built-in `/_next/mcp`. `browser_eval` (Playwright) works in this sandbox via Chromium baked into the image.

## Things you must NOT do

- Commit secrets, API keys, env values, or anything from the corpus.
- Roll your own auth, vector store, rate limiter, or component library.
- Hard-code anything Alex-specific. Persona text/avatar must be data-driven from a config (`lib/persona.ts` reads from env / a JSON file).
- Push to GitHub. The butler agent on the host pushes; you commit locally.

## Workflow

1. Read `SPEC.md`. Disagree on the issues page (we'll add one) before changing it.
2. Bootstrap from the Vercel chat-sdk template (see SPEC.md "Bootstrap" section).
3. Work on a branch (`feat/<thing>`), commit often with meaningful messages.
4. When ready, tell the user. The butler reviews, squash-rebases if needed, pushes, opens a PR.
