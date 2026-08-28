import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/config/**",
        "src/entities/**",
      ],
      reporter: ["text", "html"],

      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
});