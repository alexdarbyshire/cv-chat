"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast as sonnerToast } from "sonner";
import { cn } from "@/lib/utils";
import { CheckCircleFillIcon, WarningIcon } from "./icons";

const iconsByType: Record<"success" | "error", ReactNode> = {
  success: <CheckCircleFillIcon />,
  error: <WarningIcon />,
};

export function toast(props: Omit<ToastProps, "id">) {
  return sonnerToast.custom(
    (id) => (
      <Toast
        cta={props.cta}
        description={props.description}
        id={id}
        type={props.type}
      />
    ),
    { duration: props.cta ? 12_000 : undefined }
  );
}

function Toast(props: ToastProps) {
  const { id, type, description, cta } = props;

  const descriptionRef = useRef<HTMLDivElement>(null);
  const [multiLine, setMultiLine] = useState(false);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) {
      return;
    }

    const update = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      const lines = Math.round(el.scrollHeight / lineHeight);
      setMultiLine(lines > 1);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex toast-mobile:w-[356px] w-full justify-center">
      <div
        className={cn(
          "flex toast-mobile:w-fit w-full flex-col gap-2 rounded-lg bg-card border border-border/50 shadow-[var(--shadow-float)] p-3"
        )}
        data-testid="toast"
        key={id}
      >
        <div
          className={cn(
            "flex flex-row gap-3",
            multiLine ? "items-start" : "items-center"
          )}
        >
          <div
            className={cn(
              "data-[type=error]:text-red-600 data-[type=success]:text-green-600",
              { "pt-1": multiLine }
            )}
            data-type={type}
          >
            {iconsByType[type]}
          </div>
          <div className="text-foreground text-sm" ref={descriptionRef}>
            {description}
          </div>
        </div>
        {cta ? (
          <a
            className="self-start rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
            data-testid="toast-cta"
            href={cta.href}
          >
            {cta.label}
          </a>
        ) : null}
      </div>
    </div>
  );
}

type ToastProps = {
  id: string | number;
  type: "success" | "error";
  description: string;
  cta?: { label: string; href: string };
};
