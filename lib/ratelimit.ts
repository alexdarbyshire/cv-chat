import { createClient } from "redis";

import { isProductionEnvironment } from "@/lib/constants";
import { ChatbotError } from "@/lib/errors";

const MAX_MESSAGES = 10;
const TTL_SECONDS = 60 * 60;

/**
 * Sign-in CTA the guest 429 surface dangles in front of rate-limited
 * visitors (SPEC §3.2 & §3.3). Hardcoded path because Auth.js with
 * `basePath: "/api/auth"` resolves it consistently across environments.
 */
const GUEST_RATE_LIMIT_CTA = {
  label: "Continue with Google",
  href: "/api/auth/signin/google?callbackUrl=/",
} as const;

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!client && process.env.REDIS_URL) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on("error", () => undefined);
    client.connect().catch(() => {
      client = null;
    });
  }
  return client;
}

export async function checkIpRateLimit(
  ip: string | undefined,
  userType: "guest" | "regular" = "guest"
) {
  if (!isProductionEnvironment || !ip) {
    return;
  }

  const redis = getClient();
  if (!redis?.isReady) {
    return;
  }

  try {
    const key = `ip-rate-limit:${ip}`;
    const [count] = await redis
      .multi()
      .incr(key)
      .expire(key, TTL_SECONDS, "NX")
      .exec();

    if (typeof count === "number" && count > MAX_MESSAGES) {
      throw new ChatbotError(
        "rate_limit:chat",
        undefined,
        userType === "guest" ? { ...GUEST_RATE_LIMIT_CTA } : undefined
      );
    }
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }
  }
}
