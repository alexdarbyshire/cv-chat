import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { isSessionOwner } from "@/lib/auth/owner";
import {
  createGuestUser,
  getOrCreateGoogleUser,
  migrateGuestChatsToUser,
} from "@/lib/db/queries";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
      /**
       * Whether the signed-in user is the persona's owner (computed
       * server-side from `OWNER_EMAIL`). Surfaced on the session so client
       * components — specifically the citation renderer (SPEC §3.1
       * Rule 2) — can apply the owner-only chip filter without a round-trip.
       */
      isOwner: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    /**
     * Google OAuth (SPEC §3.2). The Google→DB upsert lives in the `jwt`
     * callback below, NOT in `profile()`, because Auth.js v5 core overrides
     * the user.id returned by `profile()` with `crypto.randomUUID()` before
     * the jwt callback runs (see
     * packages/core/src/lib/actions/callback/oauth/callback.ts ~L204; tracked
     * in https://github.com/nextauthjs/next-auth/issues/8377). Resolving the
     * DB user here would therefore set a value the framework discards. We
     * keep `profile()` to a minimal id/email/name/image shape and re-resolve
     * the persisted User row when we own the token.
     */
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: { params: { scope: "openid email profile" } },
      profile: (profile) => ({
        id: profile.sub,
        email: profile.email,
        name: profile.name ?? profile.email,
        image: profile.picture ?? null,
        type: "regular",
      }),
    }),
    /**
     * Guest sessions (SPEC §3.2). Signed cookie, no password — created on
     * first request to /api/auth/guest. Distinct from the email/password
     * Credentials provider that the chat-sdk template ships with; that
     * provider was removed in Sprint 12 along with /register and the
     * email/password form on /login.
     */
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        const [guestUser] = await createGuestUser();
        return { ...guestUser, type: "guest" };
      },
    }),
  ],
  callbacks: {
    /**
     * Sets `token.id` and `token.type` on first sign-in.
     *
     * Google: re-resolve the `User` row here (not in `profile()`) because
     * Auth.js v5 core overrides `user.id` with a random UUID before this
     * callback runs — any id we set in `profile()` is discarded. We use
     * `account.provider === "google"` as the discriminator so the
     * Credentials path stays untouched.
     *
     * Credentials/guest: the `user.id` returned by `authorize()` reaches us
     * intact, so we just copy it.
     *
     * Account linking (SPEC §3.2): when the previous token was a guest and
     * the new token is regular, we migrate the guest's chats to the new
     * Google user id once. Idempotent if it ran already.
     */
    async jwt({ token, user, account, profile }) {
      if (user) {
        const wasGuest = token.type === "guest";
        const previousGuestId = wasGuest ? token.id : null;

        if (account?.provider === "google") {
          if (!profile?.email) {
            throw new Error("google sign-in: profile.email missing");
          }
          const dbUser = await getOrCreateGoogleUser({
            email: profile.email,
            name: typeof profile.name === "string" ? profile.name : null,
            image: typeof profile.picture === "string" ? profile.picture : null,
          });
          token.id = dbUser.id;
          token.type = "regular";
        } else {
          token.id = user.id as string;
          token.type = user.type;
        }

        if (
          wasGuest &&
          previousGuestId &&
          previousGuestId !== token.id &&
          token.type === "regular"
        ) {
          try {
            const { chatsMoved } = await migrateGuestChatsToUser({
              fromGuestUserId: previousGuestId,
              toUserId: token.id,
            });
            if (chatsMoved > 0) {
              console.info(
                `[auth] migrated ${chatsMoved} guest chats: ${previousGuestId} -> ${token.id}`
              );
            }
          } catch (error) {
            console.error("[auth] guest chat migration failed", error);
          }
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
        session.user.isOwner = isSessionOwner(session);
      }

      return session;
    },
  },
});
