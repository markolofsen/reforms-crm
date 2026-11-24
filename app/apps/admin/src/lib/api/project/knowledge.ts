import { getKnowledgeText, listKnowledge } from "@hub/api";
import { knowledgeListDto, knowledgeTextDto, type KnowledgeView } from "@hub/contract/knowledge";
import { readGenerated } from "../client";

/** One project's Knowledge (P127 V13). */
export const knowledgeApi = {
  /** P70: the Knowledge table, filtered and searched on the server. */
  list: (project: string, filter: KnowledgeView, q: string) => readGenerated(listKnowledge(project, { filter, q }), knowledgeListDto),
  /** P128 X6: one entry's text, shown under its row. */
  text: (project: string, key: string) => readGenerated(getKnowledgeText(project, { key }), knowledgeTextDto),
};
