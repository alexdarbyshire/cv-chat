/**
 * Persona module — the single source of truth for who the bot speaks as.
 *
 * Forks set persona via env vars (PERSONA_NAME, PERSONA_*_URL, …) so the
 * codebase contains no hard-coded identity. Defaults match the canonical
 * cv-chat deployment but can be overridden without code changes.
 */

export type Voice = "first-person" | "assistant";

export type Persona = {
  displayName: string;
  voice: Voice;
  seedQuestions: readonly string[];
  socials: {
    blog?: string;
    github?: string;
    linkedin?: string;
  };
};

const DEFAULT_SEED_QUESTIONS = [
  "What's your DevOps and platform-engineering experience?",
  "Tell me about a time you led a team.",
  "What home-infra projects have you built recently?",
  "Walk me through a project you're proud of.",
] as const;

function envUrl(value: string | undefined): string | undefined {
  if (!value) {
    return;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const persona: Persona = {
  displayName: process.env.PERSONA_NAME?.trim() || "Alex Darbyshire",
  voice: "first-person",
  seedQuestions: DEFAULT_SEED_QUESTIONS,
  socials: {
    blog: envUrl(process.env.PERSONA_BLOG_URL),
    github: envUrl(process.env.PERSONA_GITHUB_URL),
    linkedin: envUrl(process.env.PERSONA_LINKEDIN_URL),
  },
};
