import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./context.ts";

export type SecretName = "notion-token" | "telegram-bot-token";
const SECRET_NAMES: SecretName[] = ["notion-token", "telegram-bot-token"];
export const secretPath = (ctx: Ctx, n: SecretName) => path.join(ctx.configDir, n);

export function readSecret(ctx: Ctx, n: SecretName): string | undefined {
  const p = secretPath(ctx, n);
  if (!existsSync(p)) return undefined;
  const v = readFileSync(p, "utf8").trim();
  return v || undefined;
}

/** "ok", or a one-line reason. Never returns the value. */
export function secretState(ctx: Ctx, n: SecretName): { ok: boolean; detail: string } {
  const p = secretPath(ctx, n);
  if (!existsSync(p)) return { ok: false, detail: `${p} is missing` };
  if (!readSecret(ctx, n)) return { ok: false, detail: `${p} is empty` };
  const mode = statSync(p).mode & 0o777;
  if (mode & 0o077) return { ok: false, detail: `${p} is mode ${mode.toString(8)}, must be 600` };
  return { ok: true, detail: `stored, mode 600` };
}

export function storeSecret(ctx: Ctx, n: SecretName, value: string): string {
  mkdirSync(ctx.configDir, { recursive: true, mode: 0o700 });
  chmodSync(ctx.configDir, 0o700);
  const p = secretPath(ctx, n);
  writeFileSync(p, value.trim() + "\n", { mode: 0o600 });
  chmodSync(p, 0o600);
  return p;
}

/** Remove every known secret value from text before it is shown or logged. */
export function redact(ctx: Ctx, text: string): string {
  let out = text;
  for (const n of SECRET_NAMES) {
    const v = readSecret(ctx, n);
    if (v && v.length >= 8) out = out.split(v).join("***");
  }
  return out.replace(/\b(sk-ant-[A-Za-z0-9_-]{6,}|ntn_[A-Za-z0-9]{6,}|secret_[A-Za-z0-9]{10,}|\d{5,}:[A-Za-z0-9_-]{30,})\b/g, "***");
}
