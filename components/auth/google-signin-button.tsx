"use client";

import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function GoogleSignInButton() {
  const searchParams = useSearchParams();
  const callbackUrl = (() => {
    const raw = searchParams?.get("callbackUrl") ?? "/";
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  })();
  const [pending, startTransition] = useTransition();

  return (
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
  );
}
