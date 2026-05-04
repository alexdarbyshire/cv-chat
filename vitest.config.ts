import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "tests/**"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    alias: [
      {
        find: /^@\/(.*)/,
        replacement: `${new URL(".", import.meta.url).pathname}$1`,
      },
    ],
  },
});
