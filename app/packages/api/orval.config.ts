import { defineConfig } from "orval";

export default defineConfig({
  hub: {
    input: { target: "./openapi.json" },
    output: {
      clean: true,
      client: "fetch",
      mode: "tags-split",
      schemas: "./src/generated/models",
      target: "./src/generated",
      urlEncodeParameters: true,
      override: {
        mutator: {
          name: "hubMutator",
          path: "./src/runtime/mutator.ts",
        },
      },
    },
  },
  hubZod: {
    input: { target: "./openapi.json" },
    output: {
      clean: true,
      client: "zod",
      mode: "tags-split",
      target: "./src/generated-zod",
    },
  },
});
