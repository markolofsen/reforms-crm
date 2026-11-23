import type { FakePorts } from "./ports";
import type { ReplayCase } from "./replay";

// The first replay cases (P129 verdict 10): the live failures of the plan's section 2d and the owner's log, each as the path a
// skill now documents. The fixture project is acme-travel copied as `acme` (account owner@acme.example, sender
// hello@acme.example); clients are invented. Mail ids: 42 a client's message, 50 our sent reply, 60 a mail from the owner's test
// address, 70 a new client's question.

export const ACCOUNT = "owner@acme.example";
export const TEST_ADDRESS = "owner.test@example.com";
const ANN = "ann@x.example";

/** Ann wrote (mail 42, Message-ID m1@example.com) and the Hub has her draft; `sent` marks it sent from Mail. */
async function annWithDraft(p: FakePorts, sent = false): Promise<Record<string, number>> {
  p.mail.inbound.set("m1@example.com", { account: ACCOUNT, mailboxPath: ["INBOX"], messageId: 42 });
  p.mail.headers.set(42, `From: Ann <${ANN}>\nTo: hello@acme.example\nSubject: Hello\nMessage-ID: <m1@example.com>\n`);
  const { draftId } = await p.write((r) => r.drafts.record({ project: p.slug, email: ANN, name: "Ann", subject: "Re: Hello", mailRef: "<m1@example.com>", excerpt: "Wie viel kostet die Reise nach Lissabon?" }));
  if (sent) {
    await p.write((r) => r.drafts.markSent(draftId, { at: "2026-11-20T10:00:00.000Z", via: "sent-mailbox", messageId: "m50@example.com" }));
    // Our sent copy in Sent: the newest message of her thread.
    p.mail.headers.set(50, `From: Acme Travel <hello@acme.example>\nTo: Ann <${ANN}>\nSubject: Re: Hello\nMessage-ID: <m50@example.com>\n`);
  }
  return { draft: draftId };
}

/** The `collection://` url of the Clients database in a `project_show` answer. */
const clientsUrl = (show: unknown): string[] => ((show as { notion?: { databases?: Array<{ role: string; url: string }> } })?.notion?.databases ?? []).filter((d) => d.role === "clients").map((d) => d.url);

const POEM = "напиши короткое стихотворение про осень и положи черновик на мой тестовый адрес";
const TRANSLATE = "переведи этот черновик на английский";
const AGAIN = "напиши ей ещё раз про весеннюю скидку";
const ANSWER_TEST = "ответь на это письмо";

export const REPLAY_CASES: readonly ReplayCase[] = [
  {
    title: "a poem to the owner's test address (test mode, a new thread on his words, no Notion check)",
    prompt: POEM,
    ports: { recipients: { test: [TEST_ADDRESS] } },
    steps: [
      { name: "mcp__hub__project_show", input: {} },
      {
        name: "mcp__hub__draft_write",
        input: { kind: "new", to: TEST_ADDRESS, subject: "Осень", content: "Листья кружат над водой,\nДень становится короче.", owner_request: POEM, record: { skill: "bulk-drafts", notion: { kind: "none" }, reason: "The owner asked for a short autumn poem as a draft." } },
      },
    ],
    drafts: [{ email: TEST_ADDRESS, status: "ready" }],
  },
  {
    title: "a translation of the focused draft (kind revise, on his words)",
    prompt: TRANSLATE,
    setup: (p) => annWithDraft(p),
    steps: [
      { name: "mcp__hub__draft_show", input: ({ seed }) => ({ draft: seed.draft }) },
      { name: "mcp__hub__draft_write", input: ({ seed }) => ({ kind: "revise", draft: seed.draft, content: "Hello Ann,\n\nthe trip to Lisbon costs [Owner: price].", owner_request: TRANSLATE }) },
    ],
    drafts: [{ email: ANN, status: "ready" }],
  },
  {
    title: "a new message after a sent draft: the revision is refused already_sent, the new reply to our sent copy is written",
    prompt: AGAIN,
    setup: (p) => annWithDraft(p, true),
    steps: [
      { name: "mcp__hub__draft_write", input: ({ seed }) => ({ kind: "revise", draft: seed.draft, content: "Spring discount.", owner_request: AGAIN }), refusal: "already_sent" },
      {
        name: "mcp__hub__draft_write",
        input: { kind: "reply", message: { account: ACCOUNT, mailbox_path: ["Sent"], message_id: 50 }, content: "Hello Ann,\n\nthis spring we take 10% off every trip to Lisbon.", owner_request: AGAIN, record: { name: "Ann", skill: "bulk-drafts", notion: { kind: "none" }, reason: "The owner asked to write to Ann again about the spring discount." } },
      },
    ],
    drafts: [{ email: ANN, status: "ready" }],
  },
  {
    title: "a mail from the owner's test address is answered as a client's (never not_a_client)",
    prompt: ANSWER_TEST,
    ports: { recipients: { test: [TEST_ADDRESS] } },
    setup: async (p) => {
      p.mail.headers.set(60, `From: Owner Test <${TEST_ADDRESS}>\nTo: hello@acme.example\nSubject: Проверка\nMessage-ID: <m60@example.com>\n`);
      return {};
    },
    steps: [
      { name: "mcp__hub__message_show", input: { message: { account: ACCOUNT, mailbox_path: ["INBOX"], message_id: 60 } } },
      { name: "mcp__hub__draft_write", input: { kind: "reply", message: { account: ACCOUNT, mailbox_path: ["INBOX"], message_id: 60 }, content: "Здравствуйте!\n\nСпасибо за письмо, всё работает.", owner_request: ANSWER_TEST, record: { skill: "triage-mail", notion: { kind: "none" }, reason: "They wrote to check that mail works; the reply confirms it." } } },
    ],
    drafts: [{ email: TEST_ADDRESS, status: "ready" }],
  },
  {
    title: "the record of a first draft in a triage: history, profile and knowledge read, then draft_write with its record",
    prompt: "разбери почту проекта acme",
    setup: async (p) => {
      p.mail.headers.set(70, "From: Bruno <bruno@y.example>\nTo: hello@acme.example\nSubject: Booking for May\nMessage-ID: <m70@example.com>\n");
      await p.write((r) => r.projects.replaceRegistry({ projects: [{ slug: p.slug, name: "Acme Travel", status: "active", settingsJson: "{}", hash: "replay" }], addresses: [] }));
      return {};
    },
    steps: [
      { name: "mcp__hub__project_show", input: {} },
      { name: "mcp__mail-mcp__find_messages", input: { account: ACCOUNT, sender: "bruno@y.example" }, result: { content: [{ type: "text", text: '[{"id":70,"from":"bruno@y.example","subject":"Booking for May","date":"2026-11-21T08:00:00Z"}]' }] } },
      { name: "mcp__mail-mcp__get_message_content", input: { account: ACCOUNT, mailbox_path: ["INBOX"], message_id: 70 }, result: { content: [{ type: "text", text: "From: bruno@y.example\n\nCan I cancel my booking for 4 guests in May?" }] } },
      { name: "mcp__hub__message_show", input: { message: { account: ACCOUNT, mailbox_path: ["INBOX"], message_id: 70 } } },
      // The profile read: the project's Clients data source by the id project_show gave (step 0), never a search.
      {
        name: "mcp__notion__notion-query-data-sources",
        input: ({ results }) => ({ data_source_urls: clientsUrl(results[0]), query: "bruno@y.example" }),
        result: { content: [{ type: "text", text: '{"results":[]}' }] },
      },
      { name: "mcp__hub__knowledge_search", input: { query: "cancel booking" } },
      {
        name: "mcp__hub__draft_write",
        input: {
          kind: "reply",
          message: { account: ACCOUNT, mailbox_path: ["INBOX"], message_id: 70 },
          content: "Hello Bruno,\n\nyes, your May booking for 4 guests can be cancelled; the fee is [Owner: cancellation fee].",
          record: {
            name: "Bruno",
            skill: "triage-mail",
            notion: { kind: "none" },
            reason: "He asked whether his May booking can be cancelled; the reply says yes and leaves the fee to the owner.",
            excerpt: "Can I cancel my booking for 4 guests in May?",
            replies_owed: true,
            last_contact_at: "2026-11-21T08:00:00Z",
            injection_suspected: false,
            context: {
              batchKey: "triage-2026-11-21-rpl",
              thread: { firstContact: false, found: 1, read: 1, readIds: [70], cited: [70], newest: "2026-11-21T08:00:00Z" },
              profile: { read: true, state: "absent" },
              facts: { queries: 1, used: [], missing: ["Owner: cancellation fee"] },
              anchors: ["the booking for 4 guests in May"],
              personalization: "It answers his own booking for 4 guests in May, the one thing he asked about.",
              gaps: ["profile-empty"],
            },
          },
        },
      },
    ],
    drafts: [{ email: "bruno@y.example", status: "ready" }],
  },
];
