#!/bin/bash
# PostToolUse hook of the live-edit loop (see app/@rules/live-edit.md): one agent edit = one commit on `app-live`.
#
# Acts only when the edited file sits in a checkout whose branch is `app-live` (the live worktree). In the owner's
# main checkout, or anywhere else, it does nothing. It commits only that one file, only under <app>/apps/admin,
# and only while the main checkout has no uncommitted change under apps/admin. Exit 2 = a refusal the agent reads.
set -u

input=$(cat)
IFS=$'\037' read -r file tool msg session < <(
  printf '%s' "$input" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const j = JSON.parse(s || "{}"), i = j.tool_input || {};
      const one = (t) => String(t ?? "").replace(/[\x00-\x1f]+/g, " ").trim();
      const first = (t) => one(String(t ?? "").split("\n").find((l) => l.trim()) ?? "");
      const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
      const multi = (t) => String(t ?? "").trim().includes("\n");
      let what;
      if (j.tool_name === "Write") what = "write " + cut(first(i.content), 60);
      else if (j.tool_name === "MultiEdit") what = (i.edits || []).length + " edits: " + cut(first((i.edits || [])[0]?.new_string), 50);
      else if (!multi(i.old_string) && !multi(i.new_string)) {
        // one-line edit: show only what changed (common head and tail dropped)
        const a = String(i.old_string ?? ""), b = String(i.new_string ?? "");
        let h = 0; while (h < a.length && h < b.length && a[h] === b[h]) h++;
        let t = 0; while (t < a.length - h && t < b.length - h && a[a.length - 1 - t] === b[b.length - 1 - t]) t++;
        const x = one(a.slice(h, a.length - t)), y = one(b.slice(h, b.length - t));
        what = !x ? "add " + JSON.stringify(cut(y, 50)) : !y ? "remove " + JSON.stringify(cut(x, 50)) : JSON.stringify(cut(x, 40)) + " -> " + JSON.stringify(cut(y, 40));
      }
      else what = cut(first(i.new_string), 70);
      process.stdout.write([i.file_path || "", j.tool_name || "", what, j.session_id || ""].join("\x1f") + "\n");
    });'
)
[ -n "${file:-}" ] || exit 0

dir=$(dirname "$file")
[ -d "$dir" ] || exit 0
wt=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ "$(git -C "$wt" symbolic-ref --short -q HEAD)" = "app-live" ] || exit 0   # not the live worktree: do nothing

abs="$(cd "$dir" && pwd -P)/$(basename "$file")"
wt=$(cd "$wt" && pwd -P)
rel=${abs#"$wt"/}
# the app dir relative to the repo root, from this script's own place: <wt>/<prefix>/scripts/live-commit.sh
app=$(cd "$(dirname "$0")/.." && pwd -P)
app_rel=${app#"$wt"/}
case "$rel" in
  "$app_rel"/apps/admin/*) ;;
  *)
    echo "live-edit: $rel is outside $app_rel/apps/admin; nothing was committed. Revert that edit." >&2
    exit 2
    ;;
esac
case "$rel" in */node_modules/*) exit 0 ;; esac

# Refuse while the owner's own checkout has uncommitted work in the admin app: app-live would drift from it.
main=$(git -C "$wt" worktree list --porcelain | awk '/^worktree /{print substr($0, 10); exit}')
if [ -n "$(git -C "$main" status --porcelain -- "$app_rel/apps/admin" 2>/dev/null)" ]; then
  echo "live-edit: the main checkout has uncommitted changes in $app_rel/apps/admin; edit not committed. Commit or discard them there; the next edit then commits this one too." >&2
  exit 2
fi

git -C "$wt" add -- "$rel" 2>/dev/null
if git -C "$wt" diff --cached --quiet -- "$rel"; then exit 0; fi   # nothing changed

subject="admin: ${tool} ${rel#"$app_rel"/apps/admin/}: ${msg}"
body="Live-Edit: ${tool}
Session: ${session:-unknown}

Co-Authored-By: Claude <noreply@anthropic.com>"
for try in 1 2 3 4 5; do
  if out=$(git -C "$wt" commit --only --no-verify -q -m "$subject" -m "$body" -- "$rel" 2>&1); then
    echo "app-live $(git -C "$wt" rev-parse --short HEAD) $subject"
    exit 0
  fi
  sleep 0.3   # another edit holds index.lock
done
echo "live-edit: commit failed: $out" >&2
exit 2
