import { defineConfig } from "vitest/config";
import { readFileSync } from "fs";

function loadDotEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env", "utf-8")
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("#"))
        .map((line) => {
          const idx = line.indexOf("=");
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
          return [key, val];
        })
        .filter(([k]) => k)
    );
  } catch {
    return {};
  }
}

export default defineConfig({
  test: {
    env: loadDotEnv(),
  },
});
