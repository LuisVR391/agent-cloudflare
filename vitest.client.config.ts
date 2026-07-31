import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src/client"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/client/**/*.test.tsx"],
    setupFiles: ["./test/client/setup.ts"],
  },
});
