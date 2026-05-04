import { motion } from "framer-motion";
import { persona } from "@/lib/persona";

const ENTRANCE_EASE = [0.22, 1, 0.36, 1] as const;

export const Greeting = () => {
  return (
    <div className="flex flex-col items-center px-4" key="overview">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.35, duration: 0.5, ease: ENTRANCE_EASE }}
      >
        Welcome to {persona.displayName}'s chat
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 max-w-xl text-center text-foreground/75 text-sm"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5, duration: 0.5, ease: ENTRANCE_EASE }}
      >
        Ask about my work and projects, or have me generate a one-pager tailored
        to whatever role you're hiring for.
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 max-w-xl text-center text-muted-foreground/70 text-xs"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.65, duration: 0.5, ease: ENTRANCE_EASE }}
      >
        {persona.greetingFooter}
      </motion.div>
    </div>
  );
};
