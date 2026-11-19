import { useQueries } from "@tanstack/react-query";
import { CheckCircle2Icon, MessageCircleQuestionIcon } from "lucide-react";
import type { SchemeNode } from "@hub/contract/scheme";
import { AppLink } from "@/components/app-link";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { placeDest, SCHEME_LOOK } from "./labels";

type Question = { project: string; question: string; options: readonly string[] };

/** The agent's open questions (`project.md`), one read per project: answered in a session, so they carry no link. */
export function useQuestions(projects: readonly string[]): Question[] {
  const qs = useQueries({ queries: projects.map((p) => ({ queryKey: keys.project(p), queryFn: () => metaApi.overview(p) })) });
  return qs.flatMap((q, i) => (q.data?.question ? [{ project: projects[i] ?? "", ...q.data.question }] : []));
}

/** The part's name: a link to the page that fixes it, unless that page is this one (a fix by a phrase is said in the item). */
function Name({ n, multi }: { n: SchemeNode; multi: boolean }) {
  const label = multi && n.project ? `${n.label} · ${n.project}` : n.label;
  if (n.place === null || n.place === "overview") return <span className="font-medium">{label}</span>;
  return (
    <AppLink className="font-medium text-foreground" inProject={n.project} to={placeDest(n.place)}>
      {label}
    </AppLink>
  );
}

function Item({ n, multi }: { n: SchemeNode; multi: boolean }) {
  const { word, Icon, tone } = SCHEME_LOOK[n.state];
  return (
    <li className="flex min-w-0 gap-3 py-3" data-part={n.id} data-state={n.state}>
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <Name multi={multi} n={n} />
          <span className="text-muted-foreground text-xs">{word}</span>
        </p>
        {n.detail && <p className="measure break-words text-muted-foreground">{n.detail}</p>}
        {n.fix && <code className="block min-w-0 whitespace-pre-wrap break-all rounded-sm bg-muted px-1.5 py-0.5 text-xs">{n.fix}</code>}
      </div>
    </li>
  );
}

function QuestionItem({ q, multi }: { q: Question; multi: boolean }) {
  return (
    <li className="flex min-w-0 gap-3 py-3" data-part="question">
      <MessageCircleQuestionIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <p className="font-medium">The agent asks{multi ? ` (${q.project})` : ""}</p>
        <p className="measure break-words">{q.question}</p>
        <p className="text-muted-foreground">Answer in a session{q.options.length > 0 ? `: ${q.options.join(", ")}` : ""}.</p>
      </div>
    </li>
  );
}

/**
 * "Needs you" (P70, Overview's one job): the agent's open questions first, then every part that is broken or needs a look, worst
 * first, each with what is wrong, the fix line (the source's own, or the phrase) and one link to where it is fixed. A part "Not
 * checked here" is nobody's failure and stays under All parts. Nothing needs him: one line, "Everything works". No control here.
 */
export function NeedsYou({ nodes, questions, multi }: { nodes: readonly SchemeNode[]; questions: readonly Question[]; multi: boolean }) {
  const items = nodes.filter((n) => n.state === "fail" || n.state === "warn");
  if (items.length === 0 && questions.length === 0) {
    return (
      <p className="flex items-center gap-2 font-medium text-base" data-testid="everything-works" role="status">
        <CheckCircle2Icon aria-hidden="true" className="size-4 text-success-foreground" />
        Everything works.
      </p>
    );
  }
  return (
    <section aria-labelledby="needs-you-title" className="flex flex-col gap-1">
      <h3 className="font-heading font-medium text-sm" id="needs-you-title">
        Needs you
      </h3>
      <ul aria-label="Needs you" className="flex flex-col divide-y border-y" data-testid="needs-you">
        {questions.map((q) => (
          <QuestionItem key={`q:${q.project}`} multi={multi} q={q} />
        ))}
        {items.map((n) => (
          <Item key={n.id} multi={multi} n={n} />
        ))}
      </ul>
    </section>
  );
}
