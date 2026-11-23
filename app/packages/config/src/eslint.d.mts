import type { Linter } from "eslint";
export const APP_ROOT: string;
export const FILE_RATCHET: Record<string, number>;
export const FUNCTION_RATCHET: Record<string, number>;
export const TYPING_RULES: Linter.RulesRecord;
export const TYPED_RULES: Linter.RulesRecord;
export const SIZE_RULES: Linter.RulesRecord;
export function ratchetFor(dirname: string): Linter.Config[];
export function hubLint(dirname: string, options?: { browser?: boolean }): Linter.Config[];
