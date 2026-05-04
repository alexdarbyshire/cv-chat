import { z } from "zod";

/**
 * Hard-bounded shape for a tailored one-page resume.
 *
 * Why bounds: the typst template renders a one-page layout. If `generateObject`
 * can't fit content within these limits the call fails validation and we fall
 * back to the static PDF — content never overflows the page silently.
 */
export const ResumeSchema = z.object({
  headline: z.string().max(80),
  summary: z.string().max(280),
  highlights: z.array(z.string().max(140)).max(4),
  roles: z
    .array(
      z.object({
        title: z.string().max(60),
        company: z.string().max(40),
        period: z.string().max(20),
        bullets: z.array(z.string().max(140)).max(4),
      })
    )
    .max(4),
  skills: z.array(z.string().max(24)).max(20),
  socials: z.object({
    blog: z.string().url().optional(),
    github: z.string().url().optional(),
    linkedin: z.string().url().optional(),
  }),
});

export type Resume = z.infer<typeof ResumeSchema>;
