import { OPERATIONS } from "../composition/operations";
import { withOperations } from "./openapi";

/** The document Orval reads: the hand-kept base plus every declared operation. */
export const emittedDocument = (base: Parameters<typeof withOperations>[0]) => withOperations(base, OPERATIONS);
