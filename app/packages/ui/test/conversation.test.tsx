import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationLabel, ConversationList, ConversationListIdentity, ConversationListItem, ConversationMessage, ConversationMessageList, ConversationText } from "../src/product/conversation";
import { ConversationComposerEditor, ConversationEditorSurface } from "../src/product/composer-editor";
import { ConversationContext, ConversationContextActions, ConversationContextItem, ConversationContextRow } from "../src/product/conversation-context";
import { ConversationBackButton, ConversationComposer, ConversationComposerFooter, ConversationEmptyState, ConversationFrame, ConversationHeader, ConversationHeaderFacts, ConversationHistoryNotice, ConversationHistoryState, ConversationHistorySummary, ConversationStaleNotice } from "../src/product/conversation-frame";
import { ListToolbar, ListToolbarRow } from "../src/product/list-toolbar";

describe("ConversationText", () => {
  it("keeps plain client text literal", () => {
    const html = renderToStaticMarkup(<ConversationText format="plain" text="**not bold** <script>alert(1)</script>" />);
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<script>");
  });

  it("autolinks safe URLs in plain client text", () => {
    const html = renderToStaticMarkup(<ConversationText format="plain" text="Open https://example.test/docs, then keep javascript:alert(1) literal." />);
    expect(html).toContain('href="https://example.test/docs"');
    expect(html).toContain("</a>, then");
    expect(html).not.toContain('href="javascript:');
  });

  it("renders bounded Markdown and rejects unsafe links", () => {
    const html = renderToStaticMarkup(<ConversationText format="markdown" text={'# Title\n\n## Section\n\n### Detail\n\n**bold** ~~removed~~ `code` [safe](https://example.test) [bad](javascript:alert(1))\n\n> quoted\n\n---\n\n```ts\nconst answer = 42;\n'} />);
    expect(html).toContain("<h3");
    expect(html).toContain("<h4");
    expect(html).toContain("<h5");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<del>removed</del>");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<hr");
    expect(html).toContain('href="https://example.test"');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("const answer = 42;");
    expect(html).toContain("<pre");
  });

  it("keeps multiline Markdown paragraphs and quotes compact", () => {
    const html = renderToStaticMarkup(<ConversationText format="markdown" text={"First line\nSecond line\n\n> quoted one\n> quoted two"} />);
    expect(html).toContain(">First line\nSecond line</p>");
    expect(html).toContain(">quoted one\nquoted two</p>");
    expect(html.match(/<blockquote/g)).toHaveLength(1);
  });

  it("autolinks safe plain URLs without swallowing punctuation", () => {
    const html = renderToStaticMarkup(<ConversationText format="markdown" text="Open https://example.test/docs, then ignore javascript:alert(1)." />);
    expect(html).toContain('href="https://example.test/docs"');
    expect(html).toContain("</a>, then");
    expect(html).not.toContain('href="javascript:');
  });
});

describe("ConversationFrame contract", () => {
  it("allows composer context facts and recovery text to wrap", () => {
    const html = renderToStaticMarkup(
      <ConversationContext>
        <ConversationContextRow>
          <ConversationContextItem label="From">hello@reforms.ai</ConversationContextItem>
        </ConversationContextRow>
        <ConversationContextActions tone="warning">A long signature warning stays inside the composer.</ConversationContextActions>
      </ConversationContext>,
    );
    expect(html).toContain("flex-wrap");
    expect(html).toContain("break-words");
  });

  it("keeps the owner editor shell shared across product surfaces", () => {
    const html = renderToStaticMarkup(<ConversationComposerEditor ariaLabel="Reply composer" onChange={() => undefined} testId="shared-editor" title="Write a reply" value="Draft" />);
    expect(html).toContain('data-testid="shared-editor"');
    // P123 U0: the composers are plain text until P93's RTF path lands: no formatting toolbar, no Markdown editor.
    expect(html).toContain('data-editor="plain-text"');
    expect(html).not.toContain('role="toolbar"');
    expect(html).not.toContain("tiptap");
    expect(html).not.toContain("Plain text, saved as written");
    const detailed = renderToStaticMarkup(<ConversationComposerEditor ariaLabel="Reply composer" onChange={() => undefined} showEditorMeta title="Write a reply" value="Draft" />);
    expect(detailed).toContain("Plain text, saved as written");
  });

  it("lets an existing draft reuse the editor surface without nesting a composer", () => {
    const html = renderToStaticMarkup(<ConversationEditorSurface ariaLabel="Edit draft" onChange={() => undefined} title="Edit draft" value="Draft" />);
    expect(html).toContain("Edit draft");
    expect(html).toContain('data-editor="plain-text"');
    expect(html).not.toContain('data-pane="composer"');
  });

  it("keeps long conversation labels available without widening the bubble", () => {
    const html = renderToStaticMarkup(<ConversationLabel value="A long receiving address or subject" />);
    expect(html).toContain('aria-label="A long receiving address or subject"');
  });

  it("keeps the mobile conversation escape action shared and responsive", () => {
    const html = renderToStaticMarkup(<ConversationBackButton label="Back to chats" onClick={() => undefined} />);
    expect(html).toContain('aria-label="Back to chats"');
    expect(html).toContain("@3xl:hidden");
    expect(html).toContain("Back to chats");
  });

  it("accepts an optional focus restoration callback without changing the server contract", () => {
    const html = renderToStaticMarkup(<ConversationBackButton onClick={() => undefined} onRestoreFocus={() => undefined} />);
    expect(html).toContain('aria-label="Back"');
    expect(html).not.toContain("onRestoreFocus");
  });

  it("separates only the header facts that are present", () => {
    const html = renderToStaticMarkup(<ConversationHeaderFacts><span>Telegram</span>{null}<span>Notion</span></ConversationHeaderFacts>);
    expect(html).toContain("Telegram");
    expect(html).toContain("Notion");
    expect(html.match(/aria-hidden=\"true\"/g)).toHaveLength(1);
  });

  it("lets narrow header actions use the full wrapped row", () => {
    const html = renderToStaticMarkup(<ConversationHeader actions={<button type="button">Open in Notion</button>} title="A very long conversation title" />);
    expect(html).toContain("max-w-full");
    expect(html).toContain("@3xl:max-w-[min(50%,24rem)]");
  });

  it("keeps history, composer and message direction addressable", () => {
    const html = renderToStaticMarkup(
      <ConversationFrame
        ariaLabel="Conversation"
        composer={<ConversationComposer ariaLabel="Reply composer" footer={<button type="button">Save</button>}>Reply body</ConversationComposer>}
        header={<ConversationHeader title="Client" />}
      >
        <ConversationMessageList>
          <ConversationMessage author="Client" direction="in">Incoming</ConversationMessage>
          <ConversationMessage author="You" direction="out">Outgoing</ConversationMessage>
        </ConversationMessageList>
      </ConversationFrame>,
    );
    expect(html).toContain('aria-label="Conversation history"');
    expect(html).toContain('data-pane="composer"');
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain('data-direction="in"');
    expect(html).toContain('data-direction="out"');
    expect(html).toContain('data-ours="false"');
    expect(html).toContain('data-ours="true"');
    expect(html).toContain('aria-label="Messages"');
    expect(html).toContain('data-slot="composer-actions"');
  });

  it("keeps stale history visible with one retry action", () => {
    const html = renderToStaticMarkup(<ConversationStaleNotice detail="The last loaded messages remain available." onRetry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Showing the last conversation that loaded");
    expect(html).toContain("The last loaded messages remain available.");
    expect(html).toContain(">Retry<");
    expect(html.match(/data-slot="alert-action"/g)).toHaveLength(1);
  });

  it("keeps refresh notices inside the shared history inset", () => {
    const html = renderToStaticMarkup(<ConversationHistoryNotice><ConversationStaleNotice onRetry={() => undefined} /></ConversationHistoryNotice>);
    expect(html).toContain('data-slot="conversation-history-notice"');
    expect(html).toContain("lg:px-6");
  });

  it("keeps older-history summaries on one compact shared rhythm", () => {
    const html = renderToStaticMarkup(<ConversationHistorySummary>Earlier: 2 messages are not shown.</ConversationHistorySummary>);
    expect(html).toContain('data-slot="conversation-history-summary"');
    expect(html).toContain("py-2");
    expect(html).toContain("lg:px-6");
  });

  it("can hand spacing to a full empty-state child without adding a second inset", () => {
    const html = renderToStaticMarkup(<ConversationHistoryState flush><div data-slot="empty-child">Nothing here</div></ConversationHistoryState>);
    expect(html).toContain('data-slot="empty-child"');
    expect(html).toContain("p-0");
    expect(html).not.toContain("p-6");
  });

  it("keeps empty conversations on the shared frame", () => {
    const html = renderToStaticMarkup(<ConversationEmptyState subtitle="Choose a person"><div data-slot="empty-content">Nothing to open</div></ConversationEmptyState>);
    expect(html).toContain('data-slot="conversation-header"');
    expect(html).toContain('data-slot="conversation-history-state"');
    expect(html).toContain('data-slot="empty-content"');
  });

  it("puts composer feedback above the action row", () => {
    const html = renderToStaticMarkup(<ConversationComposerFooter feedback={<span>Could not save the draft.</span>}><button type="button">Save draft</button></ConversationComposerFooter>);
    expect(html).toContain('data-slot="composer-feedback"');
    expect(html).toContain("basis-full");
  });

  it("keeps compact contact rows visually and semantically addressable", () => {
    const html = renderToStaticMarkup(
      <ConversationListItem dataAgentRef="chat:3" dataAttributes={{ "data-chat": 3 }} open selected>
        <button type="button">Evgeniy</button>
      </ConversationListItem>,
    );
    expect(html).toContain('data-agent-ref="chat:3"');
    expect(html).toContain('data-chat="3"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain("hover:bg-accent/80");
  });

  it("keeps contact rows on one minimum-height rhythm", () => {
    const html = renderToStaticMarkup(<ConversationListItem>Person</ConversationListItem>);

    expect(html).toContain("min-h-16");
  });

  it("keeps contact lists on one semantic wrapper", () => {
    const html = renderToStaticMarkup(<ConversationList ariaLabel="People"><ConversationListItem>Person</ConversationListItem></ConversationList>);

    expect(html).toContain('aria-label="People"');
    expect(html).toContain('data-slot="conversation-list"');
    expect(html).toContain("min-w-0");
  });

  it("keeps integration context beside the leading contact identity", () => {
    const html = renderToStaticMarkup(
      <ConversationListIdentity leading={<span>Telegram</span>} marker={<span>Notion</span>} name="Mark Effect" time="now" />,
    );
    expect(html.indexOf("Telegram")).toBeLessThan(html.indexOf("Notion"));
    expect(html.indexOf("Notion")).toBeLessThan(html.indexOf("Mark Effect"));
  });

  it("lets selection actions own the toolbar semantics without nesting toolbars", () => {
    const html = renderToStaticMarkup(
      <ListToolbar ariaLabel="Mail filters" role={null}>
        <ListToolbarRow>
          <div role="toolbar">Selected actions</div>
        </ListToolbarRow>
      </ListToolbar>,
    );
    expect(html.match(/role="toolbar"/g)).toHaveLength(1);
  });

  it("anchors responsive list controls to the list toolbar width", () => {
    const html = renderToStaticMarkup(
      <ListToolbar ariaLabel="Messenger filters">
        <ListToolbarRow><span>Filters</span></ListToolbarRow>
      </ListToolbar>,
    );
    expect(html).toContain("@container");
  });
});
