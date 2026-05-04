import { z } from "zod";

/**
 * Hard-bounded content shape for a tailored one-page resume.
 *
 * The typst template renders a one-page layout; if `generateObject` can't fit
 * content within these limits the call fails validation and the pipeline
 * falls back to the static PDF. Content never overflows the page silently.
 *
 * Persona-derived fields (name, socials) are NOT part of the model output —
 * they're injected post-validate from `lib/persona.ts`. Keeping them out of
 * the model schema avoids hallucinated URLs and keeps a fork's persona the
 * single source of truth for identity.
 */
export const ResumeContentSchema = z.object({
  headline: z.string().min(1).max(80),
  summary: z.string().min(1).max(280),
  highlights: z.array(z.string().min(1).max(140)).min(1).max(4),
  roles: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        company: z.string().min(1).max(40),
        period: z.string().min(1).max(20),
        bullets: z.array(z.string().min(1).max(140)).min(1).max(4),
      })
    )
    .min(1)
    .max(4),
  projects: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        summary: z.string().min(1).max(140),
        url: z.string().url().optional(),
      })
    )
    .max(3),
  skills: z.array(z.string().min(1).max(24)).min(1).max(20),
});

export type ResumeContent = z.infer<typeof ResumeContentSchema>;

export type ResumeSocials = {
  blog?: string;
  github?: string;
  linkedin?: string;
};

export type ResumeJSON = ResumeContent & {
  name: string;
  socials: ResumeSocials;
};

/** Combine model-generated content with persona-driven identity for the renderer. */
export function composeResumeJSON(
  content: ResumeContent,
  identity: { name: string; socials: ResumeSocials }
): ResumeJSON {
  return {
    ...content,
    name: identity.name,
    socials: identity.socials,
  };
}
