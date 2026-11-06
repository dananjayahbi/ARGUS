import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
