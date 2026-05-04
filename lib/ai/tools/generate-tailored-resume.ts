import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { isSessionOwner } from "@/lib/auth/owner";
import { getOrRenderResume } from "@/lib/resume/cache";
import { generateTailoredResume } from "@/lib/resume/generate";
import { staticFallbackUrl } from "@/lib/resume/static-fallback";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";

type GenerateTailoredResumeProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

const ROLE_FOCUS_MAX = 80;
const EMPHASIS_MAX = 60;
const EMPHASIS_COUNT_MAX = 5;

/**
 * Pin a PDF URL into the chat-sdk artifact pane (SPEC §3.8 v2). Mirrors the
 * sequence createDocument uses — kind/id/title/clear, then the kind-specific
 * payload, then finish — so the pane opens and renders without further
 * coordination from the LLM.
 */
function pinPdfArtifact(
  dataStream: UIMessageStreamWriter<ChatMessage>,
  args: { id: string; title: string; url: string }
): void {
  dataStream.write({ type: "data-kind", data: "pdf", transient: true });
  dataStream.write({ type: "data-id", data: args.id, transient: true });
  dataStream.write({ type: "data-title", data: args.title, transient: true });
  dataStream.write({ type: "data-clear", data: null, transient: true });
  dataStream.write({
    type: "data-pdfArtifact",
    data: args.url,
    transient: true,
  });
  dataStream.write({ type: "data-finish", data: null, transient: true });
}

function buildTitle(roleFocus: string): string {
  return `Tailored resume — ${roleFocus}`;
}

export const generateTailoredResumeTool = ({
  session,
  dataStream,
}: GenerateTailoredResumeProps) =>
  tool({
    description:
      "Generate a tailored one-page resume PDF for the visitor based on the conversation. Call this when they ask for a CV, resume, or downloadable summary. Distill `roleFocus` (the role/discipline the resume should aim at) and 1-5 `emphasis` topics from what's been discussed. This tool may take 5-15 seconds to return. BEFORE calling it, write one short sentence telling the visitor you're generating their CV now (e.g. \"Generating a tailored one-pager now.\"). The PDF is pinned to the artifact pane automatically — do NOT paste the URL or the resume content into chat. After it returns, write a one-line confirmation that the pin happened.",
    inputSchema: z.object({
      roleFocus: z
        .string()
        .min(1)
        .max(ROLE_FOCUS_MAX)
        .describe(
          "The role or discipline the resume should be aimed at, in plain English. Example: 'Platform engineering with a cloud-native focus'."
        ),
      emphasis: z
        .array(z.string().min(1).max(EMPHASIS_MAX))
        .min(1)
        .max(EMPHASIS_COUNT_MAX)
        .describe(
          "1-5 short topic phrases the visitor seemed most interested in, distilled from the conversation. Each phrase guides which experiences and skills to feature."
        ),
    }),
    execute: async ({ roleFocus, emphasis }) => {
      const id = generateUUID();
      const title = buildTitle(roleFocus);

      try {
        const { json } = await generateTailoredResume({
          brief: { roleFocus, emphasis },
          isOwner: isSessionOwner(session),
        });
        const cached = await getOrRenderResume(json);
        pinPdfArtifact(dataStream, { id, title, url: cached.url });
        return {
          headline: json.headline,
          cached: cached.cached,
          pinned: true,
        };
      } catch (_error) {
        const fallback = staticFallbackUrl();
        if (fallback) {
          pinPdfArtifact(dataStream, { id, title, url: fallback });
          return {
            fallback: true,
            pinned: true,
            error:
              "Tailored generation unavailable; pinned the canonical resume instead.",
          };
        }
        return {
          pinned: false,
          error:
            "Could not generate the tailored resume right now. Try again in a moment.",
        };
      }
    },
  });
