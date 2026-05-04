import { z } from "zod";

/**
 * Hard-bounded content shape for a tailored one-page resume.
 *
 * The typst template renders a one-page layout; if generated content can't fit
 * within these limits the pipeline retries with feedback (see generate.ts) and
 * falls back to the static PDF if it can never land. Content never overflows
 * the page silently.
 *
 * Persona-derived fields (name, socials) are NOT part of the model output —
 * they're injected post-validate from `lib/persona.ts`. Keeping them out of
 * the model schema avoids hallucinated URLs and keeps a fork's persona the
 * single source of truth for identity.
 *
 * `projects[].url` is `z.string().optional()` — NOT `z.string().url()`. The
 * Zod URL refinement translates to JSON Schema `format: "uri"`, which OpenAI's
 * structured-output endpoint rejects ("'uri' is not a valid format"). The
 * bounds validator below parses URLs separately and drops malformed ones,
 * which keeps OpenAI models viable as `CV_CHAT_RESUME_MODEL` overrides.
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
        url: z.string().optional(),
      })
    )
    .max(3),
  skills: z.array(z.string().min(1).max(24)).min(1).max(20),
});

export type ResumeContent = z.infer<typeof ResumeContentSchema>;

/**
 * Permissive schema used by the model. No length/array maxes and no URL
 * refinement — providers don't actually enforce JSON Schema `maxLength` on
 * structured output (OpenAI documents this explicitly; Anthropic, Google,
 * Mistral all ignore it in practice). Asking for it via the schema only
 * produces validation failures that the SDK can't surface back to the model.
 *
 * Bounds are enforced post-hoc by `validateResumeBounds`, which produces
 * specific violations the pipeline can feed back to the model on retry.
 */
export const RawResumeContentSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()),
  roles: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      period: z.string(),
      bullets: z.array(z.string()),
    })
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      summary: z.string(),
      url: z.string().optional(),
    })
  ),
  skills: z.array(z.string()),
});

export type RawResumeContent = z.infer<typeof RawResumeContentSchema>;

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

export type ResumeBoundsResult =
  | { ok: true; content: ResumeContent }
  | { ok: false; violations: string[] };

const BOUNDS = {
  headline: 80,
  summary: 280,
  highlight: 140,
  highlights: 4,
  roles: 4,
  title: 60,
  company: 40,
  period: 20,
  bullet: 140,
  bullets: 4,
  projects: 3,
  projectName: 60,
  projectSummary: 140,
  skills: 20,
  skill: 24,
} as const;

function tryHttpUrl(s: string | undefined): string | undefined {
  if (!s) {
    return;
  }
  const trimmed = s.trim();
  if (trimmed.length === 0) {
    return;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return trimmed;
    }
  } catch {
    // fall through
  }
  return;
}

/**
 * Check raw model output against the strict ResumeContent bounds. On success,
 * returns a ResumeContent (URLs cleaned: empty strings and non-http schemes
 * dropped silently — `url` is optional, so a missing URL isn't a violation).
 * On failure, returns a list of human-readable violations suitable for
 * feeding back to the model on a retry.
 */
export function validateResumeBounds(
  raw: RawResumeContent
): ResumeBoundsResult {
  const violations: string[] = [];

  const headline = raw.headline.trim();
  if (headline.length === 0) {
    violations.push("headline is empty");
  } else if (headline.length > BOUNDS.headline) {
    violations.push(
      `headline is ${headline.length} chars (max ${BOUNDS.headline})`
    );
  }

  const summary = raw.summary.trim();
  if (summary.length === 0) {
    violations.push("summary is empty");
  } else if (summary.length > BOUNDS.summary) {
    violations.push(
      `summary is ${summary.length} chars (max ${BOUNDS.summary})`
    );
  }

  if (raw.highlights.length === 0) {
    violations.push("highlights is empty (need at least 1)");
  } else if (raw.highlights.length > BOUNDS.highlights) {
    violations.push(
      `${raw.highlights.length} highlights (max ${BOUNDS.highlights})`
    );
  }
  raw.highlights.forEach((h, i) => {
    const t = h.trim();
    if (t.length === 0) {
      violations.push(`highlight[${i}] is empty`);
    } else if (t.length > BOUNDS.highlight) {
      violations.push(
        `highlight[${i}] is ${t.length} chars (max ${BOUNDS.highlight})`
      );
    }
  });

  if (raw.roles.length === 0) {
    violations.push("roles is empty (need at least 1)");
  } else if (raw.roles.length > BOUNDS.roles) {
    violations.push(`${raw.roles.length} roles (max ${BOUNDS.roles})`);
  }
  raw.roles.forEach((r, i) => {
    if (r.title.trim().length > BOUNDS.title) {
      violations.push(
        `roles[${i}].title is ${r.title.trim().length} chars (max ${BOUNDS.title})`
      );
    }
    if (r.company.trim().length > BOUNDS.company) {
      violations.push(
        `roles[${i}].company is ${r.company.trim().length} chars (max ${BOUNDS.company})`
      );
    }
    if (r.period.trim().length > BOUNDS.period) {
      violations.push(
        `roles[${i}].period is ${r.period.trim().length} chars (max ${BOUNDS.period})`
      );
    }
    if (r.bullets.length === 0) {
      violations.push(`roles[${i}].bullets is empty (need at least 1)`);
    } else if (r.bullets.length > BOUNDS.bullets) {
      violations.push(
        `roles[${i}] has ${r.bullets.length} bullets (max ${BOUNDS.bullets})`
      );
    }
    r.bullets.forEach((b, j) => {
      const t = b.trim();
      if (t.length === 0) {
        violations.push(`roles[${i}].bullets[${j}] is empty`);
      } else if (t.length > BOUNDS.bullet) {
        violations.push(
          `roles[${i}].bullets[${j}] is ${t.length} chars (max ${BOUNDS.bullet})`
        );
      }
    });
  });

  if (raw.projects.length > BOUNDS.projects) {
    violations.push(`${raw.projects.length} projects (max ${BOUNDS.projects})`);
  }
  raw.projects.forEach((p, i) => {
    const name = p.name.trim();
    const summaryText = p.summary.trim();
    if (name.length === 0) {
      violations.push(`projects[${i}].name is empty`);
    } else if (name.length > BOUNDS.projectName) {
      violations.push(
        `projects[${i}].name is ${name.length} chars (max ${BOUNDS.projectName})`
      );
    }
    if (summaryText.length === 0) {
      violations.push(`projects[${i}].summary is empty`);
    } else if (summaryText.length > BOUNDS.projectSummary) {
      violations.push(
        `projects[${i}].summary is ${summaryText.length} chars (max ${BOUNDS.projectSummary})`
      );
    }
  });

  if (raw.skills.length === 0) {
    violations.push("skills is empty (need at least 1)");
  } else if (raw.skills.length > BOUNDS.skills) {
    violations.push(`${raw.skills.length} skills (max ${BOUNDS.skills})`);
  }
  raw.skills.forEach((s, i) => {
    const t = s.trim();
    if (t.length === 0) {
      violations.push(`skill[${i}] is empty`);
    } else if (t.length > BOUNDS.skill) {
      violations.push(
        `skill[${i}] '${t}' is ${t.length} chars (max ${BOUNDS.skill})`
      );
    }
  });

  if (violations.length > 0) {
    return { ok: false, violations };
  }

  const content: ResumeContent = {
    headline,
    summary,
    highlights: raw.highlights.map((h) => h.trim()),
    roles: raw.roles.map((r) => ({
      title: r.title.trim(),
      company: r.company.trim(),
      period: r.period.trim(),
      bullets: r.bullets.map((b) => b.trim()),
    })),
    projects: raw.projects.map((p) => {
      const url = tryHttpUrl(p.url);
      return url
        ? { name: p.name.trim(), summary: p.summary.trim(), url }
        : { name: p.name.trim(), summary: p.summary.trim() };
    }),
    skills: raw.skills.map((s) => s.trim()),
  };

  return { ok: true, content };
}
