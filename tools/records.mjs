import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD_RE = /^objects\/[0-9a-f]{2}\/[^/]+\.json$/;

/**
 * Every record under objects/, as [{ path, text }].
 * Default reads the committed tree (`git ls-tree -r HEAD`), which is what CI
 * sees. `worktree: true` reads the working directory instead.
 */
export function loadRecords({ worktree = false } = {}) {
  const git = (args, input) =>
    execFileSync("git", args, { input, maxBuffer: 1 << 30 });

  const paths = (
    worktree
      ? git(["ls-files", "--cached", "--others", "--exclude-standard", "objects"])
      : git(["ls-tree", "-r", "--name-only", "HEAD", "objects"])
  )
    .toString("utf8")
    .split("\n")
    .filter((p) => RECORD_RE.test(p))
    .sort();

  if (worktree) return paths.map((path) => ({ path, text: readFileSync(path, "utf8") }));
  if (!paths.length) return [];

  const out = git(["cat-file", "--batch"], paths.map((p) => `HEAD:${p}\n`).join(""));
  const records = [];
  let off = 0;
  for (const path of paths) {
    const nl = out.indexOf(10, off);
    const [, type, size] = out.subarray(off, nl).toString("utf8").split(" ");
    if (type !== "blob") throw new Error(`${path}: not a blob`);
    const start = nl + 1;
    records.push({ path, text: out.subarray(start, start + Number(size)).toString("utf8") });
    off = start + Number(size) + 1;
  }
  return records;
}

export const parseRecords = (records) =>
  records.map(({ path, text }) => {
    try {
      return { path, record: JSON.parse(text) };
    } catch (e) {
      throw new Error(`${path}: invalid JSON (${e.message})`);
    }
  });
