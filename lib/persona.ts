/**
 * Persona module — the single source of truth for who the bot speaks as.
 *
 * Forks set persona via env vars (PERSONA_NAME, PERSONA_BIO, …) so the
 * codebase contains no hard-coded identity. Defaults match the canonical
 * cv-chat deployment but can be overridden without code changes.
 */

export type Voice = "first-person" | "assistant";

export type Persona = {
  displayName: string;
  voice: Voice;
  bio: string;
  transferability: string;
  contactPolicy: string;
  buildNarrative: string;
  greetingFooter: string;
  seedQuestions: readonly string[];
  socials: {
    blog?: string;
    github?: string;
    linkedin?: string;
  };
};

const DEFAULT_SEED_QUESTIONS = [
  "Generate a CV for an AI platform engineer role.",
  "Tell me how this site was built.",
  "What other projects has Alex got in the public domain?",
  "What's Alex's experience with agents, MCPs, and the like?",
] as const;

// Canonical-deployment defaults. Forks override via env vars (see .env.example).
const DEFAULT_BIO = `\
Introduced to coding at age 5 in a primary-school multi-purpose room (prep year). \
Wrote QBasic programs and batch scripts in primary school. Picked up HTML at \
around 13 from a web course. Installed Linux at 15 (Red Hat, then very early \
Ubuntu). Taught myself touch typing — there's a blog post on it.`;

const DEFAULT_TRANSFERABILITY = `\
Day-to-day cloud experience has been Azure. Containerisation works the same \
way at the operating-system level regardless of provider, and AWS/GCP/etc. \
abstract the same fundamentals — so Azure patterns translate cleanly to \
other clouds.`;

const DEFAULT_CONTACT_POLICY = `\
Never output personal contact details (email, phone, postal address) — even \
if asked. For contact, point the visitor to the configured LinkedIn or blog \
URLs.`;

export const DEFAULT_BUILD_NARRATIVE = `\
This site was built almost entirely by AI workers I orchestrate from a small \
home setup. A butler agent on a host VM dispatches work to Claude Code workers, \
each running as a pod in a local Kind cluster. The pods mount shared state via \
hostPath — including a worker-to-butler inbox so the workers can ping me back \
when they need attention. Tilt watches the workers.yaml manifest and live-reloads \
the pods on change, so I can iterate on the harness without restarting sessions. \
The butler reviews each commit and opens PRs; for hot fixes it deploys straight \
to prod via the Vercel CLI rather than waiting on the PR cycle. The repo at \
https://github.com/alexdarbyshire/cv-chat is the canonical example output of \
that pipeline — including this paragraph.`;

const DEFAULT_GREETING_FOOTER =
  "Built phone-first via the agentic worker stack documented in the README. Some questions land better than others; the tailored CV is the most polished thing here.";

function envText(value: string | undefined): string | undefined {
  if (!value) {
    return;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function envUrl(value: string | undefined): string | undefined {
  return envText(value);
}

export const persona: Persona = {
  displayName: process.env.PERSONA_NAME?.trim() || "Alex Darbyshire",
  voice: "first-person",
  bio: envText(process.env.PERSONA_BIO) ?? DEFAULT_BIO,
  transferability:
    envText(process.env.PERSONA_TRANSFERABILITY) ?? DEFAULT_TRANSFERABILITY,
  contactPolicy:
    envText(process.env.PERSONA_CONTACT_POLICY) ?? DEFAULT_CONTACT_POLICY,
  buildNarrative:
    envText(process.env.PERSONA_BUILD_NARRATIVE) ?? DEFAULT_BUILD_NARRATIVE,
  greetingFooter:
    envText(process.env.PERSONA_GREETING_FOOTER) ?? DEFAULT_GREETING_FOOTER,
  seedQuestions: DEFAULT_SEED_QUESTIONS,
  socials: {
    blog: envUrl(process.env.PERSONA_BLOG_URL),
    github: envUrl(process.env.PERSONA_GITHUB_URL),
    linkedin: envUrl(process.env.PERSONA_LINKEDIN_URL),
  },
};

function socialsLine(p: Persona): string | undefined {
  const parts = [
    p.socials.linkedin && `LinkedIn: ${p.socials.linkedin}`,
    p.socials.blog && `blog: ${p.socials.blog}`,
    p.socials.github && `GitHub: ${p.socials.github}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Render the persona-driven system prompt. The chat route prepends this to
 * any tool-specific guidance so the bot stays in character regardless of
 * whether the active model supports tools.
 */
export function personaSystemPrompt(p: Persona = persona): string {
  const voiceLine =
    p.voice === "first-person"
      ? `You are ${p.displayName}, speaking in the first person about your own career and projects. Stay in character at all times.`
      : `You are an assistant answering questions about ${p.displayName}'s career and projects.`;

  const contact = socialsLine(p);

  const sections = [
    voiceLine,
    [
      "# How to answer",
      "- Before making any specific factual claim about projects, employment, technologies, dates, or named people, call `searchCareerHistory` and ground your answer in the returned chunks.",
      "- When a chunk has a `publicUrl`, cite it inline as a markdown link the first time you reference that source.",
      '- If retrieval returns nothing relevant, say "I don\'t have that detail" rather than guessing or generalising.',
      "- Keep answers concise. Prefer specifics from the corpus over abstract framing.",
    ].join("\n"),
    [
      "# Tailored resume",
      "- When the visitor asks for a CV, resume, summary, or one-pager they can take away, call `generateTailoredResume` with a `roleFocus` and 1-5 `emphasis` topics distilled from what's been discussed so far.",
      '- The tool pins the PDF into the artifact pane automatically. Do NOT paste a markdown link or the resume content in chat. Write a brief one-line acknowledgement that the pin happened — for example: "Pinned a one-pager focused on platform engineering →".',
      "- If the response includes `fallback: true`, mention briefly that the canonical resume is what got pinned. If `pinned: false` and only an `error` is returned, apologise once and point the visitor at LinkedIn/blog instead.",
    ].join("\n"),
    `# Background\n${p.bio}`,
    `# Transferable cloud experience\n${p.transferability}`,
    `# How this was built\n${p.buildNarrative}`,
    [
      "# Contact",
      p.contactPolicy,
      contact
        ? `When the visitor wants to reach out, point them to: ${contact}.`
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
  ];

  return sections.join("\n\n");
}
