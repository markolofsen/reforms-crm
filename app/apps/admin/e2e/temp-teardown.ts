import { rmSync } from "node:fs";

export default function teardown(): void {
  const root = process.env.HUB_E2E_TMPDIR;
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
