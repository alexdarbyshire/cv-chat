import { genSaltSync, hashSync } from "bcrypt-ts";

/**
 * Hashes the random per-guest token used to populate the `User.password`
 * column for guest sessions. Even without an email/password login flow,
 * the schema still requires a password hash, so we generate a one-shot
 * value at guest creation. See `createGuestUser` in queries.ts.
 */
export function generateHashedPassword(password: string) {
  const salt = genSaltSync(10);
  const hash = hashSync(password, salt);

  return hash;
}
