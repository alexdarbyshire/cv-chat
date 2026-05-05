import type { UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { isSessionOwner } from "@/lib/auth/owner";
import type { FocusBrief } from "@/lib/resume/brief";
import { getOrRenderResume } from "@/lib/resume/cache";
import { generateTailoredResume } from "@/lib/resume/generate";
import { staticFallbackUrl } from "@/lib/resume/static-fallback";
import type { ChatMessage } from "@/lib/types";

export const ROLE_FOCUS_MAX = 80;
export const EMPHASIS_MAX = 60;
export const EMPHASIS_COUNT_MAX = 5;

/**
 * Pin a PDF URL into the chat-sdk artifact pane (SPEC §3.8 v2). Mirrors the
 * sequence createDocument uses — kind/id/title/clear, then the kind-specific
 * payload, then finish — so the pane opens and renders without further
 * coordination from the LLM. Reusing an existing `id` lets the pane treat
 * the new URL as an update of the prior pinned PDF rather than a fresh card.
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

export type TailoredResumeResult = {
  artifactId: string;
  pinned: boolean;
  cached?: boolean;
  fallback?: boolean;
  headline?: string;
  error?: string;
};

export async function renderAndPinTailoredResume(args: {
  id: string;
  brief: FocusBrief;
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
}): Promise<TailoredResumeResult> {
  const { id, brief, session, dataStream } = args;
  const title = `Tailored resume — ${brief.roleFocus}`;

  try {
    const { json } = await generateTailoredResume({
      brief,
      isOwner: isSessionOwner(session),
    });
    const cached = await getOrRenderResume(json);
    pinPdfArtifact(dataStream, { id, title, url: cached.url });
    return {
      artifactId: id,
      headline: json.headline,
      cached: cached.cached,
      pinned: true,
    };
  } catch (_error) {
    const fallback = staticFallbackUrl();
    if (fallback) {
      pinPdfArtifact(dataStream, { id, title, url: fallback });
      return {
        artifactId: id,
        fallback: true,
        pinned: true,
        error:
          "Tailored generation unavailable; pinned the canonical resume instead.",
      };
    }
    return {
      artifactId: id,
      pinned: false,
      error:
        "Could not generate the tailored resume right now. Try again in a moment.",
    };
  }
}
