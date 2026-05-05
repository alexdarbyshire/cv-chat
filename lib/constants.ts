import { persona } from "./persona";

export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

export const guestRegex = /^guest-\d+$/;

export const suggestions = persona.seedQuestions;

export const EMBEDDING_MODEL_ID =
  process.env.CV_CHAT_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";

export const SEARCH_CAREER_HISTORY_TOOL = "searchCareerHistory";
export const GENERATE_TAILORED_RESUME_TOOL = "generateTailoredResume";
export const UPDATE_TAILORED_RESUME_TOOL = "updateTailoredResume";
export const GET_RECENT_ACTIVITY_TOOL = "getRecentActivity";
