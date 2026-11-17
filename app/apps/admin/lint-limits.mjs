// The size caps, written once. eslint.config.mjs imports them as errors; test/rules.test.ts counts with the same rule;
// test/rule-citations.test.ts checks that `app/@rules/structure-and-naming.md` states the same numbers.
export const FILE_LINE_CAP = 300;
export const FUNCTION_LINE_CAP = 150;
// What counts as a line: a blank line and a line holding only a comment do not (eslint `max-lines` options).
export const LINE_COUNT = { skipBlankLines: true, skipComments: true };
