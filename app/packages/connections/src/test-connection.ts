import { parseAccount } from "@hub/mail/imap";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConnectionId } from "./ids";
import { NOTION_FILE } from "./kinds";
import { probeImap, probeNotion, probeTelegram, type ProbeDeps, type Verdict } from "./probe";
import { fileState, readValue } from "./store";

const invalid = (detail: string): Verdict => ({ state: "invalid", detail });

/** Reads the one secret a connection id names and probes it. Every failure is a Verdict whose text holds no value. */
export async function testConnection(dir: string, env: NodeJS.ProcessEnv, deps: ProbeDeps, id: string): Promise<Verdict> {
  const ref = parseConnectionId(id);
  if (!ref) return invalid("unknown connection");
  const fromEnv = ref.kind === "notion" && ref.file === NOTION_FILE ? env.NOTION_TOKEN?.trim() : undefined;
  if (fromEnv) return probeNotion(deps, fromEnv);
  const f = fileState(dir, ref.file);
  if (f.state === "missing") return invalid("no secret is stored");
  if (f.state === "unsafe-mode") return invalid(`the file is readable by others (mode ${f.mode}): run chmod 600`);
  if (f.state === "empty") return invalid("the file is empty");
  if (ref.kind === "mail") {
    try {
      return await probeImap(deps, parseAccount(readFileSync(join(dir, ref.file), "utf8")));
    } catch (e) {
      return invalid(`the login file is unusable: ${e instanceof Error ? e.message : "unreadable"}`);
    }
  }
  const value = readValue(dir, ref.file);
  if (value === undefined) return invalid("the file is unusable");
  return ref.kind === "notion" ? probeNotion(deps, value) : probeTelegram(deps, value);
}
