// The follow-up sweep's brains (decision 0050, P142 F4): the real one (`claude -p`, one per client) and the scripted fake.
export { followUpClaudeBrain } from "./brain";
export { fakeFollowUpBrain, type FakeFollowUpDeps } from "./fake";
export { FOLLOW_UP_ALLOWED, followUpArgs, followUpDisallowed, followUpMcp, followUpPrompt, followUpSettings } from "./session";
export { sweepStream, CHAT_DRAFT_TOOL, PLAN_TOOL, type SweepStream } from "./stream";
