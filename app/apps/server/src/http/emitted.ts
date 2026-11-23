import { OPERATIONS } from "../composition/operations";
import { openApiDocument } from "./openapi";

/** The document Orval reads: every declared operation, nothing kept by hand (P120 W2). */
export const emittedDocument = () => openApiDocument(OPERATIONS);
