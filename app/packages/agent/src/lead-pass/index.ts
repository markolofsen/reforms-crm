// The lead pass's brains (decision 0055, P147 L4): the real one (`claude -p`, one per lead) and the scripted fake.
export { leadPassClaudeBrain } from "./brain";
export { fakeLeadPassBrain, type FakeLeadPassDeps } from "./fake";
export { LEAD_PASS_ALLOWED, leadPassArgs, leadPassDisallowed, leadPassMcp, leadPassPrompt, leadPassSettings } from "./session";
export { leadStream, DECIDE_TOOL, type LeadStream } from "./stream";
