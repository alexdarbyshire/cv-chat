/**
 * Corpus allowlist for `pnpm ingest`.
 *
 * Each entry maps a path (relative to `$CORPUS_PATH`, default `~/git/career`)
 * to a visibility tier and an optional public URL. The ingest pipeline reads
 * this file at the start of every run and refuses to ingest anything that is
 * not explicitly listed (see `denyByDefault`). New corpus files surface as
 * `[unclassified]` warnings — add an entry here to ingest them.
 *
 * Visibility tiers:
 *  - "public"   — anonymous visitors can see retrieved chunks. Use only for
 *                 content that is already published on a public site (blog,
 *                 LinkedIn, OSS docs).
 *  - "private"  — only signed-in / owner-authenticated users can retrieve.
 *                 Reserved for content that's safe to share but not posted
 *                 publicly (e.g. a fuller employment history).
 *  - "exclude"  — never ingested. Listed here to make the choice deliberate.
 *
 * To add a new project / status update:
 *   1. Drop the markdown file under your corpus directory (e.g. `~/git/career/`).
 *   2. Add an entry below, with `visibility` and a `publicUrl` if applicable.
 *   3. Re-run `pnpm ingest`. Unchanged content reuses cached embeddings.
 */

export type Visibility = "public" | "private" | "exclude";

export type CorpusFile = {
  /** Path relative to CORPUS_PATH. */
  path: string;
  visibility: Visibility;
  /** URL the bot should cite when surfacing chunks from this source. */
  publicUrl?: string;
  /** Optional human-readable note (why is this here / why is it excluded). */
  note?: string;
};

export type CorpusConfig = {
  files: CorpusFile[];
  /**
   * If true, files found under CORPUS_PATH that are NOT listed in `files`
   * are skipped with a warning. If false, unclassified files are ingested
   * as `private`. Default true (safer for "don't accidentally leak").
   */
  denyByDefault: boolean;
};

/**
 * Host allowlist for the link-preview route (`/api/preview`, SPEC §3.1
 * Rule 3). The route only fetches og: metadata for URLs whose host (with
 * any leading `www.` stripped) matches an entry here, and rejects others
 * with 404. Belt-and-braces against a future poisoned chunk redirecting
 * preview fetches to internal URLs (a classic SSRF surface).
 *
 * Forks: keep this in sync with the hosts that appear in `files[].publicUrl`
 * above. If a fork's corpus cites posts on Substack or a personal domain,
 * add those hosts here. Subdomains are matched as suffixes (`linkedin.com`
 * also matches `au.linkedin.com`).
 */
export const LINK_PREVIEW_ALLOWED_HOSTS: readonly string[] = [
  "alexdarbyshire.com",
  "github.com",
  "linkedin.com",
];

export const corpusConfig: CorpusConfig = {
  denyByDefault: true,
  files: [
    {
      path: "Project_Portfolio.md",
      visibility: "public",
      note: "Curated public project portfolio. Primary source for project Q&A.",
    },
    {
      path: "all-blog-posts.md",
      visibility: "public",
      publicUrl: "https://alexdarbyshire.com",
      note: "Concatenated public blog posts. Citations should link back to the blog.",
    },
    {
      path: "linkedin-profile-copy-paste.txt",
      visibility: "public",
      publicUrl: "https://www.linkedin.com/in/alex-darbyshire-au/",
      note: "Copy-paste of public LinkedIn profile (current role, skills, experience).",
    },
    // --- Explicitly excluded (do not delete; presence here makes the call deliberate) ---
    {
      path: "all-performance-reviews.md",
      visibility: "exclude",
      note: "Performance reviews are private. Never ingest.",
    },
    {
      path: "source-documents/2022-Performance-Review.pdf",
      visibility: "exclude",
      note: "Performance review PDF. Never ingest.",
    },
    {
      path: "source-documents/2023-Performance-Review.pdf",
      visibility: "exclude",
      note: "Performance review PDF. Never ingest.",
    },
    {
      path: "source-documents/2024-Performance-Review.pdf",
      visibility: "exclude",
      note: "Performance review PDF. Never ingest.",
    },
    {
      path: "source-documents/2025-Performance-Review.pdf",
      visibility: "exclude",
      note: "Performance review PDF. Never ingest.",
    },
    {
      path: "applications/**",
      visibility: "exclude",
      note: "Job applications: tailored resumes + job ads. Excluded — current employer may view this site; we don't want a job-hunt signal.",
    },
    {
      path: "alex-darbyshire-commits.md",
      visibility: "exclude",
      note: "Concatenated commit log across private repos. Commercial sensitivity. Flip to 'private' if you want signed-in users to query it; weigh value vs noise (commit messages are repetitive).",
    },
    {
      path: "linked-recommendations-for-others/*.md",
      visibility: "exclude",
      note: "These are recommendations Alex wrote *for* other people; not about him. Low signal for this bot.",
    },
    {
      path: "2024-Resume-Job-Application.pdf",
      visibility: "exclude",
      note: "Derived artifact — content already in Project_Portfolio.md and LinkedIn.",
    },
    {
      path: "2025-RBG-Resume.pdf",
      visibility: "exclude",
      note: "Derived artifact — content already in Project_Portfolio.md and LinkedIn.",
    },
    {
      path: "resume-generic-latex/*.pdf",
      visibility: "exclude",
      note: "Derived artifact.",
    },
    {
      path: "resume-template-latex/*.pdf",
      visibility: "exclude",
      note: "Template, not content.",
    },
  ],
};
