import { generateObject } from "ai";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";
import { persona } from "@/lib/persona";
import { type SearchHit, searchCareerHistory } from "@/lib/rag/search";
import type { FocusBrief } from "./brief";
import {
  composeResumeJSON,
  ResumeContentSchema,
  type ResumeJSON,
} from "./schema";

/** Larger than the chat default — a one-pager has room to draw from more chunks. */
export const RESUME_RETRIEVAL_K = 16;

const RESUME_SYSTEM = `\
You generate a tailored one-page resume in JSON, strictly conforming to the \
provided schema. Hard rules:

- Every claim about employment, projects, technologies, or outcomes must be \
supported by the SOURCES below. Do not invent achievements, dates, employers, \
or metrics. If the sources don't cover something, leave it out.
- Tailor the content to the BRIEF: pick the experiences, projects, and skills \
that fit roleFocus and emphasis. Cut everything else — this is one page.
- Voice: first person, terse, action-led. No marketing fluff.
- Respect the field character limits exactly. Trim ruthlessly to fit.
- Skills are short tokens (e.g. "Kubernetes", "Postgres", "Terraform"). \
No grammar, no glue words.
- Do not include personal contact details (email, phone, address) under any \
circumstances; identity and socials are added by the renderer.`;

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
emphasis: ${brief.emphasis.map((e) => `- ${e}`).join("\n")}

SOURCES
${formatChunks(hits)}`;
}

export type GenerateTailoredResumeInput = {
  brief: FocusBrief;
  /** Override search breadth. Defaults to RESUME_RETRIEVAL_K. */
  k?: number;
  /** Pass through to searchCareerHistory; gates private-tier corpus. */
  isOwner?: boolean;
  /** Override the AI Gateway model id used for generateObject. */
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
};

/** Run retrieval and structured generation given a pre-derived brief. */
export async function generateTailoredResume(
  input: GenerateTailoredResumeInput
): Promise<TailoredResumeResult> {
  const { brief, isOwner, modelId } = input;
  const k = input.k ?? RESUME_RETRIEVAL_K;

  const query = [brief.roleFocus, ...brief.emphasis].join(", ");
  const hits = await searchCareerHistory(query, { k, isOwner });

  const resolvedModelId =
    modelId ?? process.env.CV_CHAT_RESUME_MODEL ?? DEFAULT_CHAT_MODEL;

  const { object: content } = await generateObject({
    model: getLanguageModel(resolvedModelId),
    schema: ResumeContentSchema,
    system: RESUME_SYSTEM,
    prompt: buildPrompt(brief, hits),
  });

  const json = composeResumeJSON(content, {
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
  };
}
