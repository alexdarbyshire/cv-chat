import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import {
  EMPHASIS_COUNT_MAX,
  EMPHASIS_MAX,
  ROLE_FOCUS_MAX,
  renderAndPinTailoredResume,
} from "./tailored-resume-shared";

type GenerateTailoredResumeProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

export const generateTailoredResumeTool = ({
  session,
  dataStream,
}: GenerateTailoredResumeProps) =>
  tool({
    description:
      "Generate a tailored one-page resume PDF for the visitor based on the conversation. Call this when they ask for a CV, resume, or downloadable summary FOR THE FIRST TIME. If a resume is already pinned and the visitor wants changes, use `updateTailoredResume` instead. Distill `roleFocus` (the role/discipline the resume should aim at) and 1-5 `emphasis` topics from what's been discussed. This tool may take 5-15 seconds to return. BEFORE calling it, write one short sentence telling the visitor you're generating their CV now (e.g. \"Generating a tailored one-pager now.\"). The PDF is pinned to the artifact pane automatically — do NOT paste the URL or the resume content into chat. After it returns, write a one-line confirmation that the pin happened. The returned `artifactId` is what you pass to `updateTailoredResume` if the visitor later asks for changes.",
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
    execute: ({ roleFocus, emphasis }) =>
      renderAndPinTailoredResume({
        id: generateUUID(),
        brief: { roleFocus, emphasis },
        session,
        dataStream,
      }),
  });
