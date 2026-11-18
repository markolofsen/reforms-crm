// Just enough of Content-Security-Policy to answer one question: would this page's policy let a script reach a URL?
// Source expressions handled: `*`, `'self'`, `'none'`, a scheme (`https:`), a host with optional scheme, `*.` wildcard, port and path prefix.

/** The directives of one policy header (several policies, comma-joined, are each enforced: all must allow). */
export function parseCsp(header: string): Map<string, string[]>[] {
  return header.split(",").map((policy) => {
    const m = new Map<string, string[]>();
    for (const part of policy.split(";")) {
      const [name, ...values] = part.trim().split(/\s+/);
      if (name && !m.has(name.toLowerCase())) m.set(name.toLowerCase(), values);
    }
    return m;
  });
}

function sourceAllows(src: string, target: URL, self: URL): boolean {
  const s = src.trim();
  if (s === "*") return /^(https?|wss?):$/.test(target.protocol);
  if (s === "'self'") return target.origin === self.origin;
  if (s.startsWith("'")) return false; // 'none', nonces, hashes, 'unsafe-*': not a host source
  if (/^[a-z][a-z0-9+.-]*:$/i.test(s)) return target.protocol === s.toLowerCase();
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+|\*)(?::(\d+|\*))?(\/.*)?$/i.exec(s);
  if (!m) return false;
  const [, scheme, wild, host = "", port, path] = m;
  // A scheme-less source takes the page's scheme, and a secure upgrade of it.
  if (scheme ? target.protocol !== `${scheme.toLowerCase()}:` : !(target.protocol === self.protocol || target.protocol === "https:")) return false;
  const th = target.hostname.toLowerCase();
  const h = host.toLowerCase();
  if (wild ? !(th.endsWith(`.${h}`)) : th !== h) return false;
  if (port && port !== "*" && (target.port || (target.protocol === "https:" ? "443" : "80")) !== port) return false;
  if (path) return path.endsWith("/") ? target.pathname.startsWith(path) : target.pathname === path;
  return true;
}

/** `undefined` when allowed; otherwise the directive that refuses it. A missing header allows everything. */
export function cspRefuses(header: string | null, directive: "connect-src" | "script-src" | "frame-src", target: URL, self: URL): string | undefined {
  if (!header) return undefined;
  for (const policy of parseCsp(header)) {
    const fallback = directive === "frame-src" ? policy.get("child-src") ?? policy.get("default-src") : policy.get("default-src");
    const list = policy.get(directive) ?? fallback;
    const used = policy.has(directive) ? directive : directive === "frame-src" && policy.has("child-src") ? "child-src" : "default-src";
    if (!list) continue;
    if (!list.some((src) => sourceAllows(src, target, self))) return used;
  }
  return undefined;
}
