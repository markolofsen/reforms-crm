import { readFileSync } from "node:fs";
import { hubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import { z } from "zod";
import { loadProject, normalizeAddress } from "@hub/projects";
import { bareId, chooseMailerKind, FakeMailer, mailAppMailer, type MailDraft, type Mailer, type MailerKind, type DraftQuery, type ThreadMessage, type ThreadQuery } from "@hub/send";

// Which Mailer the server sends with (decision 0011). `HUB_MAILER` is read here and nowhere else; the rule for its
// values is `chooseMailerKind` in @hub/send. The fake never leaves the process: it is what the e2e run and tests use.

/** `<home>/config/config.json` (git-ignored), or HUB_CONFIG_FILE: where `allow_list` lives. */
export const configFile = () => hubPaths().configFile;

export function allowListOf(file: string): string[] {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { allow_list?: unknown };
    return Array.isArray(j.allow_list) ? j.allow_list.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

const ADDRESS = /[^\s,;<>"']+@[^\s,;<>"']+/g;
const addressesOf = (v: string | null | undefined): string[] => (v?.match(ADDRESS) ?? []).map(normalizeAddress);

const fixtureThread = z.object({ address: z.string(), at: z.string(), who: z.string(), direction: z.enum(["in", "out"]), subject: z.string(), excerpt: z.string() });
function fixtureThreads(file: string): Array<ThreadMessage & { address: string }> {
  try {
    return z.array(fixtureThread).parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return [];
  }
}

/**
 * A fake Mail whose drafts are the drafts of the database: each draft row appears as the Mail draft it stands for
 * (subject, recipients and text as recorded; account and sender from the project's project.md). Sending records it in
 * memory and nothing else. For `HUB_MAILER=fake` only.
 */
export function databaseBackedFake(repos: Repos, projectsDir: string, threadsFile?: string): Mailer & { sent: MailDraft[] } {
  const inner = new FakeMailer();
  return {
    get sent() {
      return inner.sent;
    },
    async findDrafts(q: DraftQuery) {
      const found: MailDraft[] = [];
      for (const project of await repos.projects.list()) {
        let config;
        try {
          config = loadProject(projectsDir, project).parsed.config;
        } catch {
          continue;
        }
        for (const d of await repos.clients.review(project, "all", { limit: 500, offset: 0 })) {
          if (d.subject !== q.subject || d.body === "") continue;
          found.push({
            ref: `fake-${d.id}`,
            messageId: bareId(d.mailRef) || null,
            account: config.mail.accounts[0] ?? null,
            sender: config.mail.sender ?? null,
            to: addressesOf(d.toAddr),
            cc: addressesOf(d.ccAddr),
            bcc: [],
            subject: d.subject,
            body: d.body,
            attachments: 0,
          });
        }
      }
      return found.filter((m) => !inner.sent.some((s) => s.ref === m.ref));
    },
    // The conversations of the fake Mail: a JSON list (`HUB_FAKE_THREADS`, e2e only) of `{ address, at, who, direction, subject, excerpt }`; none when unset.
    async thread(q: ThreadQuery, limit: number): Promise<ThreadMessage[]> {
      inner.messages = threadsFile ? fixtureThreads(threadsFile) : [];
      return inner.thread(q, limit);
    },
    send: (d) => inner.send(d),
  };
}

export interface ServerMailer {
  kind: MailerKind;
  mailer: Mailer;
}

/** Throws on a bad `HUB_MAILER`: the server refuses to start rather than guess which Mailer was meant. */
export function createServerMailer(repos: Repos, projectsDir: string, env: NodeJS.ProcessEnv = process.env): ServerMailer {
  const kind = chooseMailerKind(env);
  return kind === "fake" ? { kind, mailer: databaseBackedFake(repos, projectsDir, env.HUB_FAKE_THREADS) } : { kind, mailer: mailAppMailer() };
}
