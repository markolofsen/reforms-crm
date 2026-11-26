// The lead pass's brains (decision 0055, P147 L4): the real one (`claude -p`, one per lead) and the scripted fake.
export { leadPassClaudeBrain } from "./brain";
export { fakeLeadPassBrain, type FakeLeadPassDeps } from "./fake";
export { httpLeadPass } from "./port";
export { LEAD_PASS_ALLOWED, MAIL_PASS_ALLOWED, passAllowed, leadPassArgs, leadPassDisallowed, leadPassMcp, leadPassPrompt, leadPassSettings } from "./session";
export { leadStream, DECIDE_TOOL, MAIL_DECIDE_TOOL, type LeadStream } from "./stream";
