/**
 * Rerank eval fixtures (SPEC §7 Phase 7).
 *
 * Each entry is a query where pgvector kNN alone is *expected* to surface a
 * mixed bag — overlapping topics, generic phrasing, or queries whose answer
 * lives in a chunk that doesn't share much surface vocabulary with the
 * question. The cross-encoder rerank pass earns its place by re-ordering
 * those candidates so the chunk that actually *answers* the question floats
 * to the top.
 *
 * Expectations are NOT automated assertions. `pnpm eval:rerank` prints the
 * rerank-off and rerank-on top-N chunks side by side for a human reviewer
 * to grade before flipping `CV_CHAT_RERANK=on` on a fork.
 */

export type RerankFixture = {
  id: string;
  query: string;
  /** What "good" looks like — to be checked against the rerank-on column. */
  expectations: string[];
};

export const rerankFixtures: readonly RerankFixture[] = [
  {
    id: "azure-and-leadership",
    query: "Tell me about your Azure work and team-leadership experience.",
    expectations: [
      "rerank-on top hit centres on the project that combined cloud delivery with leading people",
      "rerank-off may pull two strong-but-disjoint chunks (one cloud, one leadership) — rerank should weight relevance to BOTH topics",
    ],
  },
  {
    id: "hard-problem",
    query: "What's a hard technical problem you solved?",
    expectations: [
      "rerank-on surfaces a chunk with concrete situation/action/outcome detail",
      "generic 'I worked on hard problems' filler should rank below specific war-story chunks",
    ],
  },
  {
    id: "platform-vs-product",
    query:
      "How do you think about platform engineering versus product engineering?",
    expectations: [
      "rerank-on surfaces a chunk that explicitly contrasts the two, not just chunks that mention 'platform' frequently",
      "embedding similarity loves keyword density — rerank should prefer the chunk that answers the *question*",
    ],
  },
  {
    id: "kubernetes-home-lab",
    query: "Have you run Kubernetes outside work?",
    expectations: [
      "rerank-on top hit is the home-lab / personal-infra chunk, not a work-project chunk that happens to mention k8s",
      "scope discrimination: 'outside work' should down-weight enterprise chunks even when they're embedding-similar",
    ],
  },
  {
    id: "rag-this-site",
    query: "How does this chatbot itself work?",
    expectations: [
      "rerank-on surfaces chunks describing cv-chat / RAG / pgvector / AI SDK setup",
      "embeddings may pull generic 'chatbot' or 'how it works' chunks — rerank should privilege self-referential corpus content",
    ],
  },
  {
    id: "recent-vs-historical",
    query: "What have you been working on recently?",
    expectations: [
      "rerank-on weights chunks that are temporally framed as recent (current project, this year)",
      "older-but-keyword-dense chunks should rank lower; this exposes whether reranking helps with the recency hint embedded in phrasing",
    ],
  },
  {
    id: "ai-agents",
    query: "What's your experience with AI agents and MCP servers?",
    expectations: [
      "rerank-on surfaces chunks naming specific agent projects (butler, cv-chat itself, MCP integrations)",
      "should beat generic 'AI experience' chunks that are embedding-close but topically vaguer",
    ],
  },
  {
    id: "ops-incident",
    query: "Walk me through a production incident you handled.",
    expectations: [
      "rerank-on top hit is a concrete incident write-up (timeline, mitigation, postmortem)",
      "broad 'ops experience' chunks should rank below the specific incident story",
    ],
  },
];
