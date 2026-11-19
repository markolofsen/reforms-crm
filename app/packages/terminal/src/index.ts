// @hub/terminal (P49): imported by apps/server only (the admin may not: architecture rule 3).
export { nodePty, type PtyOptions, type PtyProcess, type PtySpawn } from "./pty";
export { ensureSpawnHelper, nodePtyRoot, spawnHelperPath, tabShell, terminalReadiness, type ReadinessOptions, type TerminalProblem } from "./readiness";
export { presetArgv, presetOrder, sessionTitle, SERVER_ONLY_ENV, spawnLine, terminalEnv } from "./presets";
export { SessionLimitError, sessionManager, type ManagerOptions, type SessionManager, type SpawnSpec, type Viewer } from "./sessions";
export { serveTerminalSocket, terminalSocketServer, type SocketDeps } from "./socket";
