// Vitest setup of @hub/llm: no test reaches the network. The global fetch throws; OPENROUTER_API_KEY and HUB_LLM from the
// developer's shell are removed, so a test sees only what it sets itself.
import { afterAll } from "vitest";

const saved = { fetch: globalThis.fetch, key: process.env.OPENROUTER_API_KEY, mode: process.env.HUB_LLM };
delete process.env.OPENROUTER_API_KEY;
delete process.env.HUB_LLM;
globalThis.fetch = () => {
  throw new Error("@hub/llm tests never call the network: inject a transport or a fetch");
};

afterAll(() => {
  globalThis.fetch = saved.fetch;
  if (saved.key !== undefined) process.env.OPENROUTER_API_KEY = saved.key;
  if (saved.mode !== undefined) process.env.HUB_LLM = saved.mode;
});
