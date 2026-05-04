"use client";

import { useRouter } from "next/navigation";
import { suggestions } from "@/lib/constants";
import { persona } from "@/lib/persona";
import { SparklesIcon } from "./icons";

export function Preview() {
  const router = useRouter();

  const handleAction = (query?: string) => {
    const url = query ? `/?query=${encodeURIComponent(query)}` : "/";
    router.push(url);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-tl-2xl bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border/20 px-5">
        <div className="flex size-5 items-center justify-center rounded bg-muted/60 ring-1 ring-border/50">
          <SparklesIcon size={10} />
        </div>
        <span className="text-[13px] text-muted-foreground">Chatbot</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
        <div className="max-w-md text-center">
          <h2 className="font-semibold text-xl tracking-tight">
            Welcome to {persona.displayName}'s chat
          </h2>
          <p className="mt-2 text-foreground/75 text-sm">
            Ask about my work and projects, or have me generate a one-pager
            tailored to whatever role you're hiring for.
          </p>
          <p className="mt-4 text-muted-foreground/70 text-xs">
            {persona.greetingFooter}
          </p>
        </div>

        <div className="grid w-full max-w-md grid-cols-2 gap-2">
          {suggestions.map((suggestion) => (
            <button
              className="rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-left text-[11px] text-foreground/80 leading-relaxed transition-all duration-200 hover:border-border hover:bg-card hover:text-foreground"
              key={suggestion}
              onClick={() => handleAction(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-5 pb-5">
        <button
          className="flex w-full items-center rounded-2xl border border-border/30 bg-card/30 px-4 py-3 text-left text-[13px] text-muted-foreground/40 transition-colors hover:border-border/50 hover:text-muted-foreground/60"
          onClick={() => handleAction()}
          type="button"
        >
          Ask anything...
        </button>
      </div>
    </div>
  );
}
