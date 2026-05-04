import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
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
     * Google OAuth (SPEC §3.2). The `profile()` callback maps the Google
     * account to a row in our local `User` table — without this, we'd be
     * stuck in JWT-only mode and the rest of the app (which keys chats
     * and votes by `User.id`) couldn't reference the signed-in user.
     */
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: { params: { scope: "openid email profile" } },
      profile: async (profile) => {
        const dbUser = await getOrCreateGoogleUser({
          email: profile.email,
          name: profile.name,
          image: profile.picture,
        });
        return {
          id: dbUser.id,
          email: dbUser.email,
          name: profile.name ?? dbUser.email,
          image: profile.picture ?? null,
          type: "regular",
        };
      },
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
     * Account linking (SPEC §3.2): the JWT callback fires once per sign-in
     * with the previous token still in scope. When a guest signs in with
     * Google we detect the guest→regular transition, migrate the guest's
     * chats to the new Google user id, and then overwrite the token so
     * subsequent requests see the regular identity.
     */
    async jwt({ token, user }) {
      if (user) {
        const wasGuest = token.type === "guest";
        const previousGuestId = wasGuest ? token.id : null;

        token.id = user.id as string;
        token.type = user.type;

        if (
          wasGuest &&
          previousGuestId &&
          previousGuestId !== token.id &&
          user.type === "regular"
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
      }

      return session;
    },
  },
});
