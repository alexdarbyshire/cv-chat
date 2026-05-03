# cv-chat

A self-hosted, RAG-backed chatbot that answers questions about your career.

Forkable: drop in your own corpus (markdown, PDFs) and the bot speaks as you. Built on the [Vercel Chat SDK](https://chat-sdk.dev) — Next.js, AI SDK, Auth.js, Neon Postgres + pgvector, shadcn/ui.

> **Status**: design / scaffolding. See [SPEC.md](./SPEC.md).

## Why

A static portfolio or CV forces a reader to skim. A chatbot lets them ask the actual thing they're curious about — *"have you led a team?"*, *"what's your experience with X?"*, *"what home-infra projects have you built?"* — and get cited answers grounded in your real history (commits, blog posts, project portfolios) rather than marketing prose.

It's a more honest interface to a body of work than a one-page summary can be.

## How (high level)

- **Theming framework-first**: shadcn CSS variables + Tailwind tokens. The bot can be re-skinned by editing one file.
- **Retrieval as a tool**: LLM calls `search_career_history(query)` over a pgvector index of your corpus. No prompt-stuffing.
- **Public access without login**: anonymous visitors get N free messages/day (IP rate-limit). Google sign-in raises the cap.
- **Corpus stays private**: ingestion script reads from a separate, private repo and emits embeddings — career history is never committed here.

## Use it for yourself

1. Fork this repo
2. Point the ingestion script at your own corpus of work (private repo, local folder, anything)
3. Set env vars (Neon, Auth.js secret, Google OAuth, AI Gateway)
4. Deploy to Vercel

Full setup → [docs/SETUP.md](./docs/SETUP.md) (TBD)

## History

A do-over of [`interactive-cv-bot`](https://github.com/alexdarbyshire/interactive-cv-bot) (private), conceived and first deployed in June 2025 — agentically coded over a weekend on the couch. The original was built on the same Vercel chat-sdk template; the rewrite differs on three things:

- **RAG instead of env-var prompt-stuffing.** The original carried the corpus in a giant system prompt; that doesn't scale as the body of work grows.
- **Theming framework-first.** No more bespoke component overrides; everything flows from CSS-variable tokens.
- **PDF generation is content-vs-layout.** Schema-bounded JSON + typst, not LLM-produces-HTML. See [SPEC.md §3.8](./SPEC.md#38-tailored-resume-pdf-the-differentiator).

MIT-licensed so others can fork it for their own personal site.

## License

MIT

