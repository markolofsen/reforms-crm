import type { Operation } from "../http/openapi";
import { operations as instance } from "../instance/openapi";

/** Every JSON operation the server declares (P120 W1: instance; W2 adds the other domains and deletes the hand-kept base). */
export const OPERATIONS: readonly Operation[] = [...instance];
