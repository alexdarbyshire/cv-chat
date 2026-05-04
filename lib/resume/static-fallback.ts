/**
 * The canonical static resume URL — used when generation or rendering fails.
 *
 * Configured via `STATIC_RESUME_URL` env. The visitor always gets *something*:
 * if the tailored pipeline blows up, the chat tool returns this URL with an
 * apologetic note and the LLM presents it gracefully.
 *
 * Returns `undefined` when unset, so callers can decide whether a fallback is
 * available before promising one to the user.
 */
export function staticFallbackUrl(): string | undefined {
  const value = process.env.STATIC_RESUME_URL?.trim();
  return value && value.length > 0 ? value : undefined;
}
