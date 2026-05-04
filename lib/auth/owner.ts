import type { Session } from "next-auth";

/**
 * Whether the signed-in user is the persona's owner.
 *
 * Configured by setting `OWNER_EMAIL` to the persona owner's email. When that
 * env var is set and the session's email matches (case-insensitive,
 * whitespace-trimmed), retrieval and resume-generation paths include
 * private-tier corpus content. Anonymous/guest sessions and other regular
 * users always see public-tier only.
 *
 * Returns false when OWNER_EMAIL is unset — a fork that hasn't configured an
 * owner gets public-only behavior across the board, which is the safe default.
 */
export function isSessionOwner(session: Session): boolean {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) {
    return false;
  }
  const sessionEmail = session.user?.email?.trim().toLowerCase();
  return Boolean(sessionEmail) && sessionEmail === ownerEmail;
}
