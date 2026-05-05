import { Suspense } from "react";
import { GoogleSignInButton } from "@/components/auth/google-signin-button";
import { Button } from "@/components/ui/button";

/**
 * Sign-in page (SPEC §3.2). Visitors only land here from the rate-limit
 * CTA — there's no "Sign in" link in the regular chrome. Single Google
 * button, no email/password form. After OAuth, the JWT callback in
 * app/(auth)/auth.ts migrates any existing guest chats to the new
 * Google user id automatically.
 */
export default function Page() {
  return (
    <>
      <h1 className="font-semibold text-2xl tracking-tight">
        Continue with Google
      </h1>
      <p className="text-muted-foreground text-sm">
        We use your Google account email to lift the anonymous message limit. We
        never request more than email and profile scopes.
      </p>
      <Suspense fallback={<SignInButtonFallback />}>
        <GoogleSignInButton />
      </Suspense>
    </>
  );
}

function SignInButtonFallback() {
  return (
    <div className="flex flex-col gap-3">
      <Button className="w-full" disabled size="lg">
        Continue with Google
      </Button>
      <p className="text-center text-[12px] text-muted-foreground/80">
        You can keep using the chat as a guest if you'd rather not sign in.
      </p>
    </div>
  );
}
