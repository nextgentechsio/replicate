import path from "path";
import { defineConfig } from "vitest/config";

// --------------------------------------------------
// TESTS
//
// unit:        pure logic (cost table, roles, sessions,
//              input shaping, file sniffing). Fast, no I/O.
// integration: the real built app (`next start`) against
//              an in-memory MongoDB and a fake Replicate
//              API, driven over HTTP. Never touches the
//              real database or spends money.
// --------------------------------------------------

const alias = { "@": path.resolve(import.meta.dirname) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // One server and database for every file
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
