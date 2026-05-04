import { tool } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { isSessionOwner } from "@/lib/auth/owner";
import { getOrRenderResume } from "@/lib/resume/cache";
import { generateTailoredResume } from "@/lib/resume/generate";
import { staticFallbackUrl } from "@/lib/resume/static-fallback";

type GenerateTailoredResumeProps = {
  session: Session;
};

const ROLE_FOCUS_MAX = 80;
const EMPHASIS_MAX = 60;
const EMPHASIS_COUNT_MAX = 5;

export const generateTailoredResumeTool = ({
  session,
}: GenerateTailoredResumeProps) =>
  tool({
    description:
      "Generate a tailored one-page resume PDF for the visitor based on the conversation. Call this when they ask for a CV, resume, or downloadable summary. Distill `roleFocus` (the role/discipline the resume should aim at) and 1-5 `emphasis` topics from what's been discussed. Returns a public URL to the rendered PDF — present it as a markdown link with a one-line summary; do NOT paste the resume content into chat.",
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
      try {
        const { json } = await generateTailoredResume({
          brief: { roleFocus, emphasis },
          isOwner: isSessionOwner(session),
        });
        const cached = await getOrRenderResume(json);
        return {
          url: cached.url,
          headline: json.headline,
          cached: cached.cached,
        };
      } catch (_error) {
        const fallback = staticFallbackUrl();
        if (fallback) {
          return {
            url: fallback,
            fallback: true,
            error:
              "Tailored generation unavailable; here's the canonical resume.",
          };
        }
        return {
          error:
            "Could not generate the tailored resume right now. Try again in a moment.",
        };
      }
    },
  });
