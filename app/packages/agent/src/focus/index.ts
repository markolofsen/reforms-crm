// `@hub/agent/focus` (P72): the reader, the hook line, the resolvers per ref kind and the pointer file.
export { readFocus, readFocusFile, type FocusDepth } from "./read";
export { focusLine } from "./line";
export { RESOLVERS, resolveRef, type ResolveCtx, type Resolver } from "./resolvers";
export { livePointer, readPointerFile, writePointer } from "./pointer";
