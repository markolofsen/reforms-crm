// The messenger autopilot's brains (decision 0048, P139 A3): the real one (`claude -p`, one per turn) and the scripted fake.
export { claudeBrain, type ClaudeBrainDeps, type Spawn } from "./brain";
export { fakeBrain, type FakeBrainDeps } from "./fake";
export { AUTOPILOT_ALLOWED, autopilotArgs, autopilotDisallowed, autopilotEnv, autopilotMcp, autopilotPrompt, autopilotSettings } from "./session";
export { initRefusal, turnStream, DRAFT_TOOL } from "./stream";
