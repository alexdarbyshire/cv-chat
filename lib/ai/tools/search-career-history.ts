import { tool } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { DEFAULT_K, searchCareerHistory } from "@/lib/rag/search";

type SearchCareerHistoryProps = {
  session: Session;
};

const MAX_K = 12;

/**
 * Owner detection: when OWNER_EMAIL is set and matches the signed-in user's
 * email, the bot returns private chunks too. Anonymous/guest sessions and
 * other regular users only see public-tier chunks.
 */
function isSessionOwner(session: Session): boolean {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) {
    return false;
  }
  const sessionEmail = session.user?.email?.trim().toLowerCase();
  return Boolean(sessionEmail) && sessionEmail === ownerEmail;
}

export const searchCareerHistoryTool = ({
  session,
}: SearchCareerHistoryProps) =>
  tool({
    description:
      "Search the persona's career history corpus (projects, blog posts, profile) by semantic similarity. Call this BEFORE making any specific factual claim about projects, employment, or technical experience. Returns chunks with their source path and (when available) a publicUrl to cite.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          "Natural-language search query. Phrase it the way the source content is likely to be written (e.g. 'home lab kubernetes setup' rather than 'do you have k8s exp')."
        ),
      k: z
        .number()
        .int()
        .min(1)
        .max(MAX_K)
        .optional()
        .describe(
          `Number of chunks to retrieve. Defaults to ${DEFAULT_K}. Increase only when the question is broad.`
        ),
    }),
    execute: async ({ query, k }) => {
      const hits = await searchCareerHistory(query, {
        k,
        isOwner: isSessionOwner(session),
      });

      return {
        query,
        count: hits.length,
        chunks: hits.map((hit) => ({
          content: hit.content,
          headingPath: hit.headingPath,
          sourcePath: hit.sourcePath,
          publicUrl: hit.publicUrl,
        })),
      };
    },
  });
