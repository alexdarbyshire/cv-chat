import { generateText, type ModelMessage, Output } from "ai";
import { DEFAULT_RESUME_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { persona } from "@/lib/persona";
import { type SearchHit, searchCareerHistory } from "@/lib/rag/search";
import type { FocusBrief } from "./brief";
import {
  inventionFeedback,
  logCleanGeneration,
  logInventedClaims,
  type ProvenanceMode,
  provenanceMode,
  stripInventedClaims,
  validateResumeProvenance,
} from "./provenance";
import {
  composeResumeJSON,
  type RawResumeContent,
  RawResumeContentSchema,
  type ResumeContent,
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

PROVENANCE — every highlight and every roles[].bullet is an object \
{ text, provenance: { sourcePath, headingPath } }. The provenance MUST point \
back to the chunk that supports the claim. Use the EXACT sourcePath and \
headingPath strings shown in the SOURCES block — copy them character-for-\
character. Do not invent values; do not paraphrase the headingPath. If a \
chunk has no headingPath shown, use an empty string for headingPath. Skills, \
projects, the headline, and the summary do not carry provenance.

HARD LIMITS — count characters before submitting; the validator rejects \
overshoots and you'll be asked to rewrite tighter:
- headline ≤ 80 chars
- summary ≤ 280 chars
- ≤ 4 highlights, each text ≤ 140 chars
- ≤ 4 roles, each with ≤ 4 bullets, each text ≤ 140 chars
- title ≤ 60, company ≤ 40, period ≤ 20 chars
- ≤ 3 projects (name ≤ 60, summary ≤ 140)
- ≤ 20 skill tokens, each ≤ 24 chars`;

function formatChunks(hits: SearchHit[]): string {
  return hits
    .map((hit, i) => {
      const headingPath = hit.headingPath ?? "";
      return [
        `[${i + 1}] sourcePath: ${hit.sourcePath}`,
        `    headingPath: ${headingPath}`,
        "    content:",
        hit.content
          .split("\n")
          .map((line) => `      ${line}`)
          .join("\n"),
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function buildPrompt(brief: FocusBrief, hits: SearchHit[]): string {
  return `BRIEF
roleFocus: ${brief.roleFocus}
emphasis:
${brief.emphasis.map((e) => `- ${e}`).join("\n")}

SOURCES (use sourcePath and headingPath verbatim in claim provenance)
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
  /** Override the provenance enforcement mode for this call. */
  provenanceMode?: ProvenanceMode;
};

export type TailoredResumeResult = {
  json: ResumeJSON;
  /** Validated content with provenance still attached — used by `eval:resume`. */
  content: ResumeContent;
  brief: FocusBrief;
  sources: Array<{
    sourcePath: string;
    headingPath?: string;
    publicUrl?: string;
  }>;
  /** 1 = first pass landed, 2 = needed one retry, etc. */
  attempts: number;
  /** Claims dropped by the lenient-mode provenance validator. */
  droppedClaims: Array<{
    location: string;
    text: string;
    provenance: { sourcePath: string; headingPath: string };
  }>;
};

export class ResumeBoundsError extends Error {
  readonly violations: readonly string[];
  constructor(message: string, violations: string[]) {
    super(message);
    this.name = "ResumeBoundsError";
    this.violations = violations;
  }
}

export class ResumeProvenanceError extends Error {
  readonly invented: readonly {
    location: string;
    text: string;
    provenance: { sourcePath: string; headingPath: string };
  }[];
  constructor(
    message: string,
    invented: readonly {
      location: string;
      text: string;
      provenance: { sourcePath: string; headingPath: string };
    }[]
  ) {
    super(message);
    this.name = "ResumeProvenanceError";
    this.invented = invented;
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
 * Truth methodology (SPEC §3.8): each claim carries provenance. Post-bounds,
 * we cross-check provenance against retrieved chunks. In lenient mode we
 * drop offending claims silently; in strict mode we feed the inventions
 * back to the model and retry.
 *
 * Throws ResumeBoundsError when the model still violates bounds after
 * MAX_RETRIES retries. Throws ResumeProvenanceError in strict mode when
 * the model still invents provenance after the same retry budget.
 */
export async function generateTailoredResume(
  input: GenerateTailoredResumeInput
): Promise<TailoredResumeResult> {
  const { brief, isOwner, modelId } = input;
  const k = input.k ?? RESUME_RETRIEVAL_K;
  const mode: ProvenanceMode = input.provenanceMode ?? provenanceMode();

  const query = [brief.roleFocus, ...brief.emphasis].join(", ");
  const hits = await searchCareerHistory(query, { k, isOwner });

  const resolvedModelId =
    modelId ?? process.env.CV_CHAT_RESUME_MODEL ?? DEFAULT_RESUME_MODEL;
  const languageModel = getLanguageModel(resolvedModelId);

  const userPrompt = buildPrompt(brief, hits);
  const messages: ModelMessage[] = [{ role: "user", content: userPrompt }];

  let lastViolations: string[] = [];
  let lastInvented: ReturnType<typeof validateResumeProvenance>["invented"] =
    [];
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await generateText({
      model: languageModel,
      system: RESUME_SYSTEM,
      messages,
      output: Output.object({
        schema: RawResumeContentSchema,
        name: "resume",
        description: "Tailored one-page resume content with provenance",
      }),
    });

    const rawOutput = result.output as RawResumeContent;

    // Provenance check first: in lenient mode we strip invented claims
    // before bounds, so a stripped role with zero bullets gets caught by
    // bounds (which then triggers a feedback retry) rather than going out
    // the door silently.
    const provCheck = validateResumeProvenance(rawOutput, hits);
    let workingRaw: RawResumeContent = rawOutput;
    let droppedClaims: typeof provCheck.invented = [];
    if (!provCheck.ok) {
      logInventedClaims(provCheck.invented, { mode, attempt: attempt + 1 });
      lastInvented = provCheck.invented;
      if (mode === "strict") {
        if (attempt < MAX_RETRIES) {
          messages.push(
            { role: "assistant", content: JSON.stringify(rawOutput) },
            { role: "user", content: inventionFeedback(provCheck.invented) }
          );
          continue;
        }
        // Out of retries in strict mode — fail.
        throw new ResumeProvenanceError(
          `Resume still cited invented sources after ${MAX_RETRIES + 1} attempts (strict mode)`,
          provCheck.invented
        );
      }
      // Lenient: strip and continue with bounds.
      workingRaw = stripInventedClaims(rawOutput, provCheck.invented);
      droppedClaims = provCheck.invented;
    }

    const validated = validateResumeBounds(workingRaw);
    if (validated.ok) {
      logCleanGeneration({
        mode,
        attempt: attempt + 1,
        chunkCount: hits.length,
        claimCount:
          validated.content.highlights.length +
          validated.content.roles.reduce((acc, r) => acc + r.bullets.length, 0),
      });
      const json = composeResumeJSON(validated.content, {
        name: persona.displayName,
        socials: persona.socials,
      });
      return {
        json,
        content: validated.content,
        brief,
        sources: hits.map((hit) => ({
          sourcePath: hit.sourcePath,
          headingPath: hit.headingPath,
          publicUrl: hit.publicUrl,
        })),
        attempts: attempt + 1,
        droppedClaims: [...droppedClaims],
      };
    }

    lastViolations = validated.violations;
    if (attempt === MAX_RETRIES) {
      break;
    }

    messages.push(
      { role: "assistant", content: JSON.stringify(rawOutput) },
      { role: "user", content: violationsFollowup(validated.violations) }
    );
  }

  // Strict-mode invention errors are thrown above; reaching this point means
  // bounds couldn't be satisfied within the retry budget.
  if (lastInvented.length > 0 && mode === "strict") {
    throw new ResumeProvenanceError(
      `Resume still cited invented sources after ${MAX_RETRIES + 1} attempts (strict mode)`,
      lastInvented
    );
  }
  throw new ResumeBoundsError(
    `Resume content still violated bounds after ${MAX_RETRIES + 1} attempts`,
    lastViolations
  );
}
