import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConversationList } from "@hub/ui/product/conversation";
import { ConversationRow, type ConversationSummary } from "@hub/ui/product/list/conversation-row";
import { SearchField } from "@hub/ui/product/list/search-field";

const rows: ConversationSummary[] = [
  { ref: "client:1", name: "Ana Teste", label: "Ana Teste", time: "2 min", strong: true, state: "Wrote you", subject: "Invoice for October", preview: "Could you resend the invoice with our new address?" },
  { ref: "client:2", name: "Bruno Exemplo", label: "Bruno Exemplo", time: "1 h", strong: true, state: "Draft ready", subject: "Trial extension", agent: "Agent: asks for a price the knowledge lacks", chips: [{ id: "checks", text: "2 checks", variant: "warning" }] },
  { ref: "chat:3", name: "Carla Amostra", label: "Carla Amostra", time: "yesterday", strong: false, state: "Waiting for them", preview: "Thanks, I will try tomorrow." },
];

/** The shared row of Mail and Messengers (P127 C1) with the one search box: a link per row, the open one filled. */
function RowsAndSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState("client:1");
  const shown = rows.filter((r) => r.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex w-[360px] flex-col gap-2 border bg-background p-2">
      <SearchField label="Search people" onChange={setQ} value={q} />
      <ConversationList ariaLabel="People">
        {shown.map((r) => (
          <ConversationRow
            key={r.ref}
            open={r.ref === open}
            render={(content, className) => (
              <a aria-current={r.ref === open ? "page" : undefined} className={className} href={`#${r.ref}`} onClick={(e) => { e.preventDefault(); setOpen(r.ref); }}>
                {content}
              </a>
            )}
            selected={r.ref === open}
            summary={r}
          />
        ))}
      </ConversationList>
    </div>
  );
}

const meta = { title: "Product/Conversation row", component: RowsAndSearch } satisfies Meta<typeof RowsAndSearch>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
