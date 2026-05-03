# cv-chat — Specification

> **Status: DRAFT.** This is the do-over of `interactive-cv-bot` (private). Goals:
> - Framework-first; no hacky overrides.
> - RAG over the career corpus (the env-var prompt-stuffing approach has aged out).
> - Clean public history; OSS-licensed (MIT); reusable by other devs.
> - Themed to match a personal blog without bespoke component overrides.

## 1. Product

A chatbot that answers questions about a person's body of work — projects, technical experience, writing, contributions. The hosted instance speaks as the repo owner (first person). Forks of the repo speak as whoever runs them.

### User stories

- **Casual visitor, anonymous**: lands on the page, asks 1–3 questions ("have you worked on X?", "experience with Terraform?"), gets cited answers. No login required.
- **Engaged visitor, signed in**: signs in with Google after hitting the anonymous limit; gets ~25 messages/day with persisted history.
- **Curious peer**: follows a citation back to a specific blog post or public repo the bot referenced. Citations always link to public sources when possible.
- **Forking dev**: clones the repo, points `CORPUS_PATH` at their own markdown, runs `pnpm ingest`, deploys.

### Out of scope (for v1)

- Multi-tenant — one corpus per deployment.
- Streaming reasoning UI / tool-call inspector. Adds noise the audience won't use.
- Voice / audio.
- File uploads from users.
- A separate "static resume download" UX. The tailored PDF generator (§3.8) is the shine on top; a static PDF is just a fallback if generation fails.

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 App Router | Vercel chat-sdk template baseline |
| Lang | TypeScript (strict) | Standard |
| AI SDK | `ai` v5+ | `ToolLoopAgent` pattern |
| Default model | Claude Sonnet 4.6 (via AI Gateway) | Quality first; swappable via env |
| Embeddings | OpenAI `text-embedding-3-small` | Cheap, good, 1536-dim |
| Vector store | Neon Postgres + pgvector | Already on Neon for chat history; one extension, no extra service |
| Auth | Auth.js (NextAuth v5) | Already in the template; supports guest + Google |
| Rate limit | Upstash Redis (`@upstash/ratelimit`) | Free tier covers this; idiomatic |
| Components | shadcn/ui + Tailwind | Template default; CSS-variable theming |
| Theme switcher | `next-themes` | Standard pairing with shadcn |
| Storage | Vercel Blob (template default) | Caches generated PDFs by content hash |
| PDF rendering | typst (WASM via `@myriaddreamin/typst.ts`) | Modern typesetting; deterministic; runs in serverless without headless Chromium |
| Structured generation | AI SDK `generateObject` + Zod | Resume content as schema-validated JSON |
| Deploy | Vercel | Template default |

We do not introduce LangChain, LlamaIndex, a separate vector DB, or any framework that overlaps with what's above.

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser                                                           │
│   └── chat UI (shadcn) — useChat() from `ai/react`                 │
└──────────────────┬─────────────────────────────────────────────────┘
                   │ POST /api/chat
                   ▼
┌────────────────────────────────────────────────────────────────────┐
│  Next.js Route                                                     │
│   1. Auth.js → user (guest or google)                              │
│   2. Upstash rate-limit by userId|ip                               │
│   3. ToolLoopAgent.stream({ messages, tools: [                     │
│        search_career_history,                                      │
│        generate_tailored_resume,                                   │
│        link_to_blog_post,                                          │
│      ]})                                                           │
│   4. Persist messages (drizzle)                                    │
└────┬───────────────────┬────────────────────────────┬──────────────┘
     │ search            │ generate_tailored_resume   │ link
     ▼                   ▼                            ▼
┌──────────┐  ┌────────────────────────────────┐  ┌─────────────┐
│ pgvector │  │ Resume pipeline (§3.8)         │  │  blog       │
│          │  │  1. retrieve relevant chunks   │  │  index      │
└──────────┘  │  2. generateObject(ResumeJSON) │  └─────────────┘
              │  3. typst render → PDF bytes   │
              │  4. cache in Vercel Blob       │
              │     by sha256(JSON)            │
              │  5. return public URL          │
              └────────────────────────────────┘
```

### 3.1 RAG

**Corpus inputs** (read from `$CORPUS_PATH`, never committed here):
- Markdown files (blog posts, project portfolio, perf reviews, commit annotations).
- PDFs (resumes, recommendations) — extracted to markdown via `unpdf` once, cached.
- LinkedIn profile copy.

**Chunking**: split markdown by H2/H3 headings; soft-cap chunks at ~800 tokens with 100-token overlap. PDFs split by page. Each chunk carries metadata: `source` (file path), `heading_path` (`> Career > Roles > Senior SWE`), `public_url` (when the source is publicly available — e.g. a blog post URL), `public` (boolean — gate visibility per chunk).

**Embedding**: OpenAI `text-embedding-3-small`, 1536-dim, batched. Cached on `sha256(content)` so re-runs are idempotent.

**Storage**: a single `embeddings` table with `vector(1536)`, an HNSW index. Upsert by `(source, heading_path)` so re-ingestion replaces in place.

**Retrieval**: the LLM calls `search_career_history(query: string, k?: number)` — server-side: embed the query, kNN over `WHERE public = true OR user_is_owner`, return `[{heading_path, text, public_url}, ...]`. The agent decides whether to call once or chain calls.

**Generation**: system prompt sets first-person persona ("I'm Alex, a software engineer…"). Tells the model to call `search_career_history` before claiming any specific fact, and to cite via `public_url` when present. No retrieval = "I don't have that detail in my history" (no hallucination).

### 3.2 Auth

- **Guest sessions**: Auth.js Credentials provider that creates a signed cookie on first visit, no password. Already a pattern in the chat-sdk template.
- **Google**: Auth.js Google provider. Lifts the rate-limit cap. We never request more than `email profile` scopes.
- **Account linking**: signed-in user inherits their guest session's chat history (one-time migration on first sign-in).

### 3.3 Rate limiting

Sliding window via `@upstash/ratelimit`:

| Tier | Limit | Window | Key |
|---|---|---|---|
| guest (anonymous) | 3 messages | 24h | `ip:<ip>` |
| google (signed in) | 25 messages | 24h | `user:<id>` |
| global circuit-breaker | 5000 messages | 24h | `global` |

When hit: 429 with a friendly message. Sign-in CTA for guests; "come back tomorrow" for signed-in.

### 3.4 Theming

The blog (`alexdarbyshire.com`) uses a Hugo `terminal` theme: monospace, terminal-aesthetic, light/dark.

Implementation rules:
- **Tokens only**. Colors, fonts, spacing live in `theme/tokens.css` as CSS custom properties (HSL form, shadcn convention). Components reference tokens, never hex values.
- **Tailwind reads tokens**. `tailwind.config.ts` `theme.extend.colors` maps to `hsl(var(--token))`.
- **Fonts via `next/font`**. Match the blog's monospace stack.
- **Light/dark via `next-themes`**. Pair with shadcn's `ThemeProvider`.
- **Single switchable theme module**. To re-skin a fork, edit `theme/tokens.css` and `theme/persona.ts`; nothing else.
- **Source extraction**: a one-shot script `scripts/extract-blog-theme.ts` parses the blog's CSS to seed `theme/tokens.css` accurately rather than eyeballing.

### 3.5 Persona

`theme/persona.ts` exports:

```ts
export const persona = {
  displayName: "Alex Darbyshire",  // env-overridable
  voice: "first-person",            // "first-person" | "assistant"
  systemPrompt: "...",              // template, gets corpus stats injected
  seedQuestions: [
    "What's your DevOps and platform-engineering experience?",
    "Tell me about a time you led a team.",
    "What home-infra projects have you built recently?",
  ],
  socials: { blog: "...", github: "...", linkedin: "..." },
};
```

A fork edits this file (or env vars) and gets a different persona. No code changes.

### 3.6 Chat history & persistence

- Anonymous users: messages persisted under their guest session id; auto-deleted after 30 days (cron via Vercel scheduled function).
- Signed-in users: persisted indefinitely; "delete my data" link in settings.
- Privacy notice on first visit ("your messages are stored to keep this conversation; sign in to keep them, otherwise they're cleared after 30 days").

### 3.7 Ingestion pipeline

`pnpm ingest` (or the GH Action `ingest.yml` triggered when the source corpus repo changes):

1. Read `$CORPUS_PATH` (local path or `git+ssh://…`).
2. Walk for `.md`, `.txt`, `.pdf`. Apply allowlist from `corpus.config.ts` (per-file `public: true|false`).
3. Chunk → embed → upsert into pgvector.
4. Print a diff report: added / updated / removed.

The default `corpus.config.ts` ships with safe defaults (no perf reviews public; only blog posts and the public portfolio public). A fork adjusts this for their corpus.

### 3.8 Tailored resume PDF (the differentiator)

The bot offers an on-the-fly tailored one-page summary per conversation: *"Here's a one-pager focused on platform engineering, since that's what we've been talking about."* Visitor clicks, gets a PDF.

**Why this is the shine on top.** A downloadable summary is a normal thing for a portfolio site to have. A *tailored* summary — pulled from the same corpus the chat is using, calibrated to whatever the conversation has been about — is the thing that's distinctive. It also turns a transient chat into a takeaway artifact.

**Why the previous implementation was painful.** Letting the LLM produce *content + layout* together (HTML/markdown to be rendered) means every variation in content length or shape breaks the layout. You whack-a-mole prompts to avoid each new failure mode. We will not do this.

**Architecture** — separate content from layout, hard:

```
generate_tailored_resume(role_focus, emphasis[])  ← LLM-callable tool
       │
       ├─ 1. retrieve relevant chunks (pgvector, same as chat)
       │
       ├─ 2. generateObject({                          ← AI SDK structured output
       │      schema: ResumeSchema,                    ← Zod, with character limits
       │      prompt: "Tailor for {role}, emphasis: {points}, sources: {chunks}"
       │    })
       │      → ResumeJSON (validated, deterministic shape)
       │
       ├─ 3. typst render(ResumeJSON, template)        ← deterministic typesetting
       │      → PDF bytes
       │
       ├─ 4. cache: Vercel Blob, key = sha256(JSON)
       │
       └─ 5. return { url, json_summary } to the LLM
              LLM presents URL in chat + a one-line summary.
```

**Schema with hard limits** — the renderer can never overflow if the input is bounded:

```ts
const ResumeSchema = z.object({
  headline: z.string().max(80),
  summary: z.string().max(280),
  highlights: z.array(z.string().max(140)).max(4),
  roles: z.array(z.object({
    title: z.string().max(60),
    company: z.string().max(40),
    period: z.string().max(20),
    bullets: z.array(z.string().max(140)).max(4),
  })).max(4),
  skills: z.array(z.string().max(24)).max(20),
  socials: z.object({ blog: z.string().url().optional(), github: z.string().url().optional(), linkedin: z.string().url().optional() }),
});
```

**Why typst, not puppeteer or `@react-pdf/renderer`:**
- typst handles page breaks and overflow gracefully; HTML/CSS doesn't (and `print` CSS is a regret factory).
- typst.ts (WASM) runs in a Vercel function with no headless Chromium — fast cold start, no big binary.
- Templates are human-readable; designers can edit them. `@react-pdf/renderer` requires writing layout in React JSX.
- Forks can swap the template by editing `templates/resume.typ`; nothing else changes.

**Caching.** The (JSON content, template version) tuple is the cache key. `sha256` it, store in Vercel Blob. Same conversation shape twice = same PDF byte-for-byte, no regeneration cost.

**Fallback.** If `generateObject` fails validation twice or typst errors, the tool returns `{ url: STATIC_RESUME_URL, error: "tailored generation unavailable, here's the canonical resume" }`. The LLM presents that gracefully. The user always gets *something*.

**Forkability.** Three things a fork might want to change:
1. `templates/resume.typ` — the template itself (their visual identity).
2. `lib/resume/schema.ts` — schema (their resume sections may differ).
3. `lib/resume/static-fallback.ts` — path/URL to the fallback static PDF.

Default template ships in the repo; the fallback PDF is configured by env (`STATIC_RESUME_URL`).

**Rate limiting** — PDF generation is more expensive than chat (two LLM calls + render). Apply a stricter sub-limit on top of the chat tier: guest=1 per session, signed-in=5 per day, global circuit breaker shared with chat.

## 4. Bootstrap

```bash
# inside the worker
cd /workspace
pnpm dlx create-next-app@latest . --use-pnpm --typescript --tailwind --app --src-dir=false --import-alias "@/*" --no-eslint  # only if not using the chat-sdk template directly

# OR — preferred — clone the chat-sdk template directly:
pnpm create chat-sdk@latest .  # if that command exists; otherwise:
git clone --depth=1 https://github.com/vercel/ai-chatbot template_tmp
mv template_tmp/{*,.*} . 2>/dev/null || true
rm -rf template_tmp .git/index.lock
```

Then add the AI SDK skill plus our chosen libs:

```bash
pnpm add @upstash/ratelimit @upstash/redis pgvector drizzle-orm/pg-core unpdf
pnpm add @myriaddreamin/typst.ts zod
pnpm add -D drizzle-kit
# the AI SDK skill is committed in .claude/skills/ already
```

Wire up:
- `lib/db/schema.ts` — add `embeddings` and `chunks` tables alongside template's chat tables
- `drizzle.config.ts` — Neon URL + pgvector extension migration
- `lib/ai/agent.ts` — define `ToolLoopAgent` with `search_career_history`, `generate_tailored_resume`, `link_to_blog_post` tools
- `lib/resume/schema.ts` — Zod `ResumeSchema` with character limits
- `lib/resume/render.ts` — typst.ts wrapper, template loader, hash-keyed Blob cache
- `templates/resume.typ` — default one-page template
- `app/api/chat/route.ts` — replace template handler with our agent + rate-limit
- `lib/auth/config.ts` — add Google provider + guest credentials provider
- `theme/tokens.css` + `theme/persona.ts`

## 5. Required environment variables

```
# Database (Neon)
DATABASE_URL=postgres://...

# Auth.js
AUTH_SECRET=...
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...

# AI Gateway (Vercel)
AI_GATEWAY_API_KEY=...

# Embeddings
OPENAI_API_KEY=...

# Rate limit
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# Persona / corpus
CORPUS_PATH=/path/to/private/career/repo
PERSONA_NAME="Alex Darbyshire"
PERSONA_BLOG_URL=https://alexdarbyshire.com
PERSONA_GITHUB_URL=https://github.com/alexdarbyshire

# Tailored resume generation
STATIC_RESUME_URL=https://.../alex-darbyshire-resume.pdf  # fallback when generation fails
RESUME_TEMPLATE_PATH=templates/resume.typ                  # override for forks; default ships in repo

# Vercel Blob (caches generated PDFs)
BLOB_READ_WRITE_TOKEN=...

# Optional model override
CV_CHAT_MODEL=anthropic/claude-sonnet-4-6  # default
```

`.env.example` ships with these and zero values.

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Runaway LLM cost | Per-tier rate limits + global circuit breaker; daily Vercel spend alert |
| Hallucinated career facts | System prompt: "use the tool before stating specifics"; stark "I don't have that detail" fallback; eval set of 20 known facts run on each PR |
| Corpus leakage to public | `public: false` chunks excluded from retrieval at the SQL `WHERE` layer (defence in depth, not just at ingest) |
| Stale embeddings | GH Action re-runs ingestion on corpus repo push |
| OAuth abuse (sign in to bypass anon limit) | Per-user limits also enforced; new accounts <24h old get the guest limit |
| Bot-driven scrape | Cloudflare Turnstile on the chat input after the first guest message |
| Tailored PDF layout breakage | Schema-bounded content (Zod `.max()` per field) + typst's overflow-handling primitives + content-hash cached output + static-PDF fallback on render error |
| Tailored PDF cost spikes | Sub-tier limits (guest=1/session, signed-in=5/day) on top of chat limits; cache hits free |
| Resume facts diverge from chat answers | Both share the same retrieval pipeline (pgvector); resume tool re-uses `search_career_history` results so the bot can't claim things in the resume it can't substantiate in chat |

## 7. Roadmap (rough)

- **Phase 1 — scaffold**: bootstrap template, theming (tokens + fonts + dark mode), persona module. Deploy to Vercel as a placeholder.
- **Phase 2 — RAG**: pgvector schema + drizzle, ingestion script, retrieval tool, eval set.
- **Phase 3 — auth + limits**: Google provider, guest session, Upstash rate-limit, history persistence.
- **Phase 4 — tailored resume PDF (the differentiator)**: Zod `ResumeSchema`, AI SDK `generateObject`, typst.ts render pipeline, default `templates/resume.typ`, Blob cache, static fallback, `generate_tailored_resume` tool wired into the agent.
- **Phase 5 — polish**: Turnstile, citation rendering with link previews, seed-question UI, mobile, transcript print stylesheet.
- **Phase 6 — make it forkable**: SETUP.md, CONTRIBUTING.md, scrub Alex-specific defaults out of code, GH Actions for ingest, sample resume template + persona config for forks.

## 8. Open questions

1. Does the chat-sdk template's existing guest-session pattern fit our anonymous-tier needs, or do we need to add a Credentials provider? (To verify in Phase 1.)
2. Should the ingestion script live in the public repo (with `corpus.config.ts` showing example shape) or in the private career repo? Currently leaning: script here, config sample here, **actual user config edited locally / in deploy env**.
3. Is `text-embedding-3-small` good enough, or do we want Voyage / Cohere for better recall on technical content? Default to OpenAI; revisit if eval recall < 0.85.
4. Do we want server-side citation rendering (extract citations from tool output, render as cards) or let the model write markdown links? Server-side is cleaner; deferred to Phase 5.
5. typst.ts (WASM) vs typst native binary in the function: WASM is the default (no native deps, portable); revisit if cold-start render time exceeds ~1s.
6. Resume template: ship one default that's role-agnostic, or three variants (technical / leadership / generalist) and let the LLM pick? Default to one — the tailoring lives in the *content*, not the template.
7. Should generated resumes be public URLs (cached Blob with public read) or signed/expiring? Default public — they're shareable artifacts; nothing in them isn't already in the chat — but use unguessable hash-based paths.
