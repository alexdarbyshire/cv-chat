import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import type { ChatMessage } from "@/lib/types";
import {
  EMPHASIS_COUNT_MAX,
  EMPHASIS_MAX,
  ROLE_FOCUS_MAX,
  renderAndPinTailoredResume,
} from "./tailored-resume-shared";

type UpdateTailoredResumeProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

export const updateTailoredResumeTool = ({
  session,
  dataStream,
}: UpdateTailoredResumeProps) =>
  tool({
    description:
      "Update the currently pinned tailored resume PDF in place. Call this when the visitor asks for changes to a resume already pinned in the artifact pane (e.g. 'make it more senior', 'emphasize Python more'). Pass `replaceArtifactId` from the prior generateTailoredResume tool call result, plus a fresh full `roleFocus` and `emphasis` reflecting the requested adjustments. Do NOT use this for the first resume — use generateTailoredResume for that. As with generate, write one short sentence before calling (e.g. \"Updating the pinned resume now.\") and a one-line acknowledgement after.",
    inputSchema: z.object({
      replaceArtifactId: z
        .string()
        .uuid()
        .describe(
          "The `artifactId` returned by the prior `generateTailoredResume` tool call. Reusing this id replaces the existing pinned PDF in place rather than spawning a second artifact."
        ),
      roleFocus: z
        .string()
        .min(1)
        .max(ROLE_FOCUS_MAX)
        .describe(
          "The full new role/discipline focus for the resume, with the visitor's change instructions merged in. Not a diff — the complete value."
        ),
      emphasis: z
        .array(z.string().min(1).max(EMPHASIS_MAX))
        .min(1)
        .max(EMPHASIS_COUNT_MAX)
        .describe(
          "The full new array of 1-5 emphasis topics, with the visitor's change instructions merged in. Not a diff — the complete list."
        ),
    }),
    execute: ({ replaceArtifactId, roleFocus, emphasis }) =>
      renderAndPinTailoredResume({
        id: replaceArtifactId,
        brief: { roleFocus, emphasis },
        session,
        dataStream,
      }),
  });
