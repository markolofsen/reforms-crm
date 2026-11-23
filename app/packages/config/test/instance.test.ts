import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTANCE_KEYS, readInstanceConfig } from "../src/instance";

// P126 K1: the one reader of config/config.json. A malformed field is left out and named; the rest still applies.
const dir = mkdtempSync(join(tmpdir(), "hub-instance-"));
const at = (name: string, body: string) => {
  const configFile = join(dir, name);
  writeFileSync(configFile, body);
  return { configFile };
};

describe("readInstanceConfig", () => {
  it("is empty with no problem when the file does not exist", () => {
    expect(readInstanceConfig({ configFile: join(dir, "none.json") })).toEqual({ config: {}, problems: [] });
  });

  it("names a file that is not JSON, or not an object, and applies nothing", () => {
    expect(readInstanceConfig(at("bad.json", "{ nope")).problems[0]).toMatch(/not valid JSON/);
    expect(readInstanceConfig(at("list.json", "[1]")).problems[0]).toMatch(/not a JSON object/);
  });

  it("reads every field of the schema", () => {
    const { config, problems } = readInstanceConfig(at("full.json", JSON.stringify({
      name: " Acme ", logo: "logo.png", account: "Work", mailboxes: ["INBOX", ""], sent_mailbox: "Sent", allow_list: ["a@example.com", 3],
      extra_dirs: ["~/notes", " "], admin_port: "4400", api_port: 4401, backup_dir: "../b", backup_repos: ["../site"],
      log: { retention_days: 30 }, llm: { monthly_cap_usd: 5, presets: { quick: ["m1"], empty: [] } }, agent: { default: "codex", unattended: true },
    })));
    expect(problems).toEqual([]);
    expect(config).toEqual({
      name: "Acme", logo: "logo.png", account: "Work", mailboxes: ["INBOX"], sent_mailbox: "Sent", allow_list: ["a@example.com"],
      extra_dirs: ["~/notes"], admin_port: "4400", api_port: 4401, backup_dir: "../b", backup_repos: ["../site"],
      log: { retention_days: 30 }, llm: { monthly_cap_usd: 5, presets: { quick: ["m1"] } }, agent: { default: "codex", unattended: true },
    });
  });

  it("leaves out a malformed field, names it, and keeps the others", () => {
    const { config, problems } = readInstanceConfig(at("mixed.json", JSON.stringify({ account: "Work", allow_list: "a@example.com", log: { retention_days: 0 }, agent: { default: "gpt", unattended: true } })));
    expect(config.account).toBe("Work");
    expect(config.allow_list).toBeUndefined();
    expect(config.log).toEqual({});
    expect(config.agent).toEqual({ unattended: true });
    expect(problems).toEqual(["allow_list must be a list of strings", "log.retention_days must be a whole number from 1 to 3650", "agent.default must be claude or codex"]);
  });

  it("is read on every call, never cached", () => {
    const f = at("live.json", JSON.stringify({ name: "One" }));
    expect(readInstanceConfig(f).config.name).toBe("One");
    writeFileSync(f.configFile, JSON.stringify({ name: "Two" }));
    expect(readInstanceConfig(f).config.name).toBe("Two");
  });

  it("lists log among its keys (the doctor warned on it while log.retention_days was read)", () => {
    expect(INSTANCE_KEYS).toContain("log");
  });
});
