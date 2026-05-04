import { generateDummyPassword } from "./db/utils";
import { persona } from "./persona";

export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

export const guestRegex = /^guest-\d+$/;

export const DUMMY_PASSWORD = generateDummyPassword();

export const suggestions = persona.seedQuestions;
