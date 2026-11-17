import type { CheckResult } from "../types";
export const pass = (detail: string): CheckResult => ({ level: "pass", detail });
export const warn = (detail: string): CheckResult => ({ level: "warn", detail });
export const fail = (detail: string): CheckResult => ({ level: "fail", detail });
