import { generateText, type ModelMessage, Output } from "ai";
import { DEFAULT_RESUME_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { persona } from "@/lib/persona";
import { type SearchHit, searchCareerHistory } from "@/lib/rag/search";
import type { FocusBrief } from "./brief";
import {
  composeResumeJSON,
  RawResumeContentSchema,
  type ResumeJSON,
  validateResumeBounds,
} from "./schema";

/** Larger than the chat default — a one-pager has room to draw from more chunks. */
export const RESUME_RETRIEVAL_K = 16;

/**
 * Extra attempts after the first response, each with the prior response's
 * bound violations fed back as a "rewrite tighter" follow-up. Gemini 2.5
 * Flash converges across attempts (observed: 5 → 3 → 1 → 0 violations on
 * the live corpus, ~16s + 6s + 5s + ~5s ≈ 32s total). 3 retries leaves
 * comfortable headroom inside the chat route's `maxDuration = 60`s budget
 * even with retrieval, typst render, and Blob upload on top.
 */
export const MAX_RETRIES = 3;

const RESUME_SYSTEM = `\
You generate a tailored one-page resume from SOURCES, in JSON conforming to \
the provided schema. Rules:

- Every claim about employment, projects, technologies, or outcomes must be \
supported by the SOURCES below. Do not invent achievements, dates, employers, \
or metrics. If the sources don't cover something, leave it out.
- Tailor to the BRIEF: pick the experiences, projects, and skills that fit \
roleFocus and emphasis. Cut everything else — this is one page.
- Voice: first person, terse, action-led. No marketing fluff.
- Skills are short tokens (e.g. "Kubernetes", "Postgres", "Terraform"). \
No grammar, no glue words.
- Do not include personal contact details (email, phone, address); identity \
and socials are added by the renderer.

HARD LIMITS — count characters before submitting; the validator rejects \
overshoots and you'll be asked to rewrite tighter:
- headline ≤ 80 chars
- summary ≤ 280 chars
- ≤ 4 highlights, each ≤ 140 chars
- ≤ 4 roles, each with ≤ 4 bullets ≤ 140 chars
- title ≤ 60, company ≤ 40, period ≤ 20 chars
- ≤ 3 projects (name ≤ 60, summary ≤ 140)
- ≤ 20 skill tokens, each ≤ 24 chars`;

function formatChunks(hits: SearchHit[]): string {
  return hits
    .map((hit, i) => {
      const heading = hit.headingPath ? ` — ${hit.headingPath}` : "";
      return `[${i + 1}] (${hit.sourcePath}${heading})\n${hit.content}`;
    })
    .join("\n\n---\n\n");
}

function buildPrompt(brief: FocusBrief, hits: SearchHit[]): string {
  return `BRIEF
roleFocus: ${brief.roleFocus}
emphasis:
${brief.emphasis.map((e) => `- ${e}`).join("\n")}

SOURCES
${formatChunks(hits)}`;
}

function violationsFollowup(violations: string[]): string {
  return `That output exceeds the limits. Specific violations:
${violations.map((v) => `- ${v}`).join("\n")}

Rewrite the resume tighter — same persona, same content focus, but trim each \
over-budget field down to within its limit. Return the full object.`;
}

export type GenerateTailoredResumeInput = {
  brief: FocusBrief;
  /** Override search breadth. Defaults to RESUME_RETRIEVAL_K. */
  k?: number;
  /** Pass through to searchCareerHistory; gates private-tier corpus. */
  isOwner?: boolean;
  /** Override the AI Gateway model id used for generation. */
  modelId?: string;
};

export type TailoredResumeResult = {
  json: ResumeJSON;
  brief: FocusBrief;
  sources: Array<{
    sourcePath: string;
    headingPath?: string;
    publicUrl?: string;
  }>;
  /** 1 = first pass landed, 2 = needed one retry, etc. */
  attempts: number;
};

export class ResumeBoundsError extends Error {
  readonly violations: readonly string[];
  constructor(message: string, violations: string[]) {
    super(message);
    this.name = "ResumeBoundsError";
    this.violations = violations;
  }
}

/**
 * Run retrieval and structured generation given a pre-derived brief.
 *
 * No provider's structured-output API actually enforces JSON Schema
 * `maxLength`/`maxItems` on the model — those are advisory. Instead of
 * fighting the model with a strict Zod schema (which fails post-validate
 * with no feedback), the pipeline uses a permissive schema for the LLM call
 * and validates bounds itself, retrying with the specific violations as
 * feedback when the model overshoots.
 *
 * Throws ResumeBoundsError when the model still violates bounds after
 * MAX_RETRIES retries. The caller (the chat tool) catches this and falls
 * back to the static resume URL when STATIC_RESUME_URL is configured.
 */
export async function generateTailoredResume(
  input: GenerateTailoredResumeInput
): Promise<TailoredResumeResult> {
  const { brief, isOwner, modelId } = input;
  const k = input.k ?? RESUME_RETRIEVAL_K;

  const query = [brief.roleFocus, ...brief.emphasis].join(", ");
  const hits = await searchCareerHistory(query, { k, isOwner });

  const resolvedModelId =
    modelId ?? process.env.CV_CHAT_RESUME_MODEL ?? DEFAULT_RESUME_MODEL;
  const languageModel = getLanguageModel(resolvedModelId);

  const userPrompt = buildPrompt(brief, hits);
  const messages: ModelMessage[] = [{ role: "user", content: userPrompt }];

  let lastViolations: string[] = [];
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await generateText({
      model: languageModel,
      system: RESUME_SYSTEM,
      messages,
      output: Output.object({
        schema: RawResumeContentSchema,
        name: "resume",
        description: "Tailored one-page resume content",
      }),
    });

    const validated = validateResumeBounds(result.output);
    if (validated.ok) {
      const json = composeResumeJSON(validated.content, {
        name: persona.displayName,
        socials: persona.socials,
      });
      return {
        json,
        brief,
        sources: hits.map((hit) => ({
          sourcePath: hit.sourcePath,
          headingPath: hit.headingPath,
          publicUrl: hit.publicUrl,
        })),
        attempts: attempt + 1,
      };
    }

    lastViolations = validated.violations;
    if (attempt === MAX_RETRIES) {
      break;
    }

    messages.push(
      { role: "assistant", content: JSON.stringify(result.output) },
      { role: "user", content: violationsFollowup(validated.violations) }
    );
  }

  throw new ResumeBoundsError(
    `Resume content still violated bounds after ${MAX_RETRIES + 1} attempts`,
    lastViolations
  );
}
