"use client";

import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

/**
 * Sign-in page (SPEC §3.2). Visitors only land here from the rate-limit
 * CTA — there's no "Sign in" link in the regular chrome. Single Google
 * button, no email/password form. After OAuth, the JWT callback in
 * app/(auth)/auth.ts migrates any existing guest chats to the new
 * Google user id automatically.
 */
export default function Page() {
  const searchParams = useSearchParams();
  const callbackUrl = (() => {
    const raw = searchParams?.get("callbackUrl") ?? "/";
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  })();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <h1 className="font-semibold text-2xl tracking-tight">
        Continue with Google
      </h1>
      <p className="text-muted-foreground text-sm">
        We use your Google account email to lift the anonymous message limit. We
        never request more than email and profile scopes.
      </p>
      <div className="flex flex-col gap-3">
        <Button
          className="w-full"
          data-testid="continue-with-google"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              signIn("google", { callbackUrl });
            })
          }
          size="lg"
        >
          {pending ? "Redirecting…" : "Continue with Google"}
        </Button>
        <p className="text-center text-[12px] text-muted-foreground/80">
          You can keep using the chat as a guest if you'd rather not sign in.
        </p>
      </div>
    </>
  );
}
