/**
 * Resume groundedness eval fixtures (SPEC §3.8 truth methodology).
 *
 * Each entry is a representative `(roleFocus, emphasis)` brief plus
 * heuristic checks the eval runner applies to the resulting bullets:
 *
 * - `allowedHeadingPaths`: regex patterns describing where claims SHOULD be
 *   sourced from. Both `sourcePath` and `headingPath` are concatenated and
 *   matched, so a pattern like `/Project_Portfolio|MVP/i` catches either
 *   the file name or a section header. A miss isn't a hard failure
 *   (retrieval is fuzzy) but shows up in the report so a reviewer can
 *   spot scope creep.
 *
 * - `forbiddenScopeWidening`: pairs of `{ from, to }` describing prose-
 *   level drift. If a claim's source (sourcePath + headingPath) matches
 *   `from` AND its text matches `to`, that's a flagged scope-widening —
 *   the LLM cited the narrow source but paraphrased it to a broader claim.
 *
 * Patterns are tuned to the canonical cv-chat corpus: a LinkedIn-style
 * copy-paste with section headers (`1. PROFILE`, `2. ABOUT SECTION`,
 * `3. EXPERIENCE SECTIONS`) plus `Project_Portfolio.md` with one heading
 * per project (e.g. `SJ AI MVP — MVP1 Hardening`, `Reveal 3.0`). Forks
 * with different corpus shapes will want to retune.
 *
 * Keep this list small — `pnpm eval:resume` makes real LLM calls and a real
 * retrieval pass per fixture, so 8-10 covers the canonical use cases.
 */

export type GroundednessFixture = {
  id: string;
  roleFocus: string;
  emphasis: readonly string[];
  /** Patterns that bullet provenance (sourcePath + headingPath) SHOULD match. */
  allowedHeadingPaths: RegExp[];
  /** Heuristic scope-widening pairs. */
  forbiddenScopeWidening: { from: RegExp; to: RegExp }[];
};

export const groundednessFixtures: readonly GroundednessFixture[] = [
  {
    id: "ai-platform-engineer",
    roleFocus: "AI platform engineer",
    emphasis: ["Kubernetes", "Azure", "agentic systems"],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio|cv-chat/i,
      /AI MVP|AI Platform|Reveal/i,
    ],
    forbiddenScopeWidening: [
      // Cited a single MVP but paraphrased to "Azure AI platform" framing.
      { from: /MVP1?\b/, to: /Azure AI platform|enterprise AI/i },
    ],
  },
  {
    id: "senior-devops",
    roleFocus: "Senior DevOps engineer",
    emphasis: ["Terraform", "CI/CD", "observability"],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio/i,
      /Reveal|MVP|EXPERIENCE/i,
    ],
    forbiddenScopeWidening: [],
  },
  {
    id: "software-engineer-ai",
    roleFocus: "Software engineer with AI focus",
    emphasis: ["RAG", "evals", "structured generation"],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio|cv-chat/i,
      /AI|Reveal|chatbot|RAG/i,
    ],
    forbiddenScopeWidening: [{ from: /prototype|MVP/i, to: /production AI/i }],
  },
  {
    id: "tech-lead",
    roleFocus: "Technical lead",
    emphasis: ["team leadership", "mentoring", "architecture decisions"],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio/i,
      /EXPERIENCE|Reveal|MVP|Lead/i,
    ],
    forbiddenScopeWidening: [
      { from: /team of \d|squad/i, to: /engineering org|department|50\+/i },
    ],
  },
  {
    id: "kubernetes-specialist",
    roleFocus: "Kubernetes specialist",
    emphasis: ["AKS", "GitOps", "ArgoCD"],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio/i,
      /Container Apps|GitOps|Kubernetes|AKS/i,
    ],
    forbiddenScopeWidening: [
      { from: /home lab|personal/i, to: /managed production/i },
    ],
  },
  {
    id: "platform-engineering-lead",
    roleFocus: "Platform engineering lead",
    emphasis: [
      "developer experience",
      "internal platforms",
      "agentic harnesses",
    ],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio|cv-chat/i,
      /Platform|Lead|DevEx|harness/i,
    ],
    forbiddenScopeWidening: [],
  },
  {
    id: "cloud-architect-azure",
    roleFocus: "Cloud architect (Azure)",
    emphasis: ["Azure landing zones", "Container Apps", "Entra ID"],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio/i,
      /Azure|ACA|Container Apps|Entra/i,
    ],
    forbiddenScopeWidening: [
      { from: /Azure|ACA/i, to: /multi-cloud|AWS\b|GCP/i },
    ],
  },
  {
    id: "founding-engineer",
    roleFocus: "Founding engineer at an AI startup",
    emphasis: ["greenfield", "RAG", "LLM evals"],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio|cv-chat/i,
      /AI|build|MVP/i,
    ],
    forbiddenScopeWidening: [],
  },
  {
    id: "data-platform-engineer",
    roleFocus: "Data platform engineer",
    emphasis: ["pgvector", "ingestion pipelines", "retrieval"],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio|cv-chat/i,
      /Data|RAG|Postgres|pgvector|MVP/i,
    ],
    forbiddenScopeWidening: [],
  },
  {
    id: "engineering-manager",
    roleFocus: "Engineering manager",
    emphasis: ["mentoring", "stakeholder management", "delivery"],
    allowedHeadingPaths: [
      /linkedin-profile|Project_Portfolio/i,
      /Manager|Lead|Mentoring|EXPERIENCE/i,
    ],
    forbiddenScopeWidening: [
      {
        from: /4 engineers|team of \d/i,
        to: /50\+ engineers|whole department/i,
      },
    ],
  },
];
