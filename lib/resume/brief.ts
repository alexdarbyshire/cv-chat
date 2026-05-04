import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getLanguageModel } from "@/lib/ai/providers";

/**
 * What the conversation has been about, distilled to a one-page-resume tailoring brief.
 *
 * Bounded the same way as the resume itself: short phrases that fit the
 * downstream prompt without dominating it. The model treats `emphasis` as
 * "topics to feature" rather than verbatim copy.
 */
export const FocusBriefSchema = z.object({
  roleFocus: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "The role or discipline the resume should be aimed at, in plain English. Examples: 'Platform engineering', 'Backend Python with cloud-native infra', 'AI/ML applications'."
    ),
  emphasis: z
    .array(z.string().min(1).max(60))
    .min(1)
    .max(5)
    .describe(
      "Short topic phrases the visitor seemed most interested in. Each is a hint for which experience or skill to feature; not a verbatim quote."
    ),
});

export type FocusBrief = z.infer<typeof FocusBriefSchema>;

const MAX_BRIEF_MESSAGES = 12;

const BRIEF_SYSTEM = `\
You read the tail of a conversation between a visitor and a portfolio chatbot \
and distill what would make a useful one-page-resume tailoring brief for them.

Rules:
- roleFocus: name the role/discipline the visitor seems interested in, even if implied. \
If the conversation is generic small-talk with no clear focus, choose the persona's \
broadest professional umbrella (e.g. "Software engineering").
- emphasis: 1-5 short phrases of topics the visitor brought up or seemed to care about. \
Pick from the conversation, not from your priors. No duplicates.
- Be terse. These phrases get fed back into another prompt.`;

/**
 * Distill recent conversation messages into a tailoring brief.
 *
 * Only the last ~12 messages are looked at — earlier history is rarely
 * predictive of what the visitor wants on the takeaway resume, and it
 * inflates token usage on every PDF request.
 */
export async function deriveFocusBrief(
  messages: ModelMessage[],
  opts: { modelId?: string } = {}
): Promise<FocusBrief> {
  const modelId =
    opts.modelId ?? process.env.CV_CHAT_RESUME_MODEL ?? DEFAULT_CHAT_MODEL;
  const tail = messages.slice(-MAX_BRIEF_MESSAGES);

  const { object } = await generateObject({
    model: getLanguageModel(modelId),
    schema: FocusBriefSchema,
    system: BRIEF_SYSTEM,
    messages: tail,
  });

  return object;
}
