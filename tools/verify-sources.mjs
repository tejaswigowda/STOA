#!/usr/bin/env node
// Gates S1 and S4.
//   S1 (always, offline): every record's id is sha256(source)[:16], is its
//      filename, and sits in the bucket named by its first two characters.
//   S4 (default; skip with --offline): re-fetch every pinned source and check
//      that its sha256 and byte count match what the record says.
//
//   node tools/verify-sources.mjs [--offline] [--worktree]
import { baseId, bucketOf, fetchBytes, ID_RE, mapLimit, sha256 } from "./lib.mjs";
import { loadRecords, parseRecords } from "./records.mjs";

const args = new Set(process.argv.slice(2));
const records = parseRecords(loadRecords({ worktree: args.has("--worktree") }));
const problems = [];
const fail = (path, msg) => problems.push(`${path}: ${msg}`);

// Pinned: a record's source carries either a full `url` or repo + commit + path.
const sourceUrl = (s) =>
  s.url ?? (s.repo && s.commit && s.path
    ? `https://raw.githubusercontent.com/${s.repo}/${s.commit}/${s.path.split("/").map(encodeURIComponent).join("/")}`
    : null);

for (const { path, record: r } of records) {
  const file = path.split("/").pop().replace(/\.json$/, "");
  const s = r.source;
  if (!ID_RE.test(file)) fail(path, "filename is not a valid id");
  if (r.id !== file) fail(path, `id "${r.id}" does not match filename`);
  if (path.split("/")[1] !== bucketOf(file)) fail(path, "record is in the wrong bucket");
  if (!s?.sha256 || !/^[0-9a-f]{64}$/.test(s.sha256)) {
    fail(path, "source.sha256 missing or malformed");
    continue;
  }
  if (r.id && baseId(r.id) !== s.sha256.slice(0, 16)) fail(path, `id is not sha256(source)[:16] (${s.sha256.slice(0, 16)})`);
}

if (!args.has("--offline")) {
  await mapLimit(records.filter(({ record }) => record.source?.sha256), 8, async ({ path, record: r }) => {
    const url = sourceUrl(r.source);
    if (!url) return fail(path, "source has no url (or repo + commit + path) to re-fetch");
    try {
      const bytes = await fetchBytes(url);
      if (sha256(bytes) !== r.source.sha256) fail(path, `source hash mismatch at ${url}`);
      if (r.source.bytes !== undefined && r.source.bytes !== bytes.length) fail(path, `source bytes ${bytes.length} != recorded ${r.source.bytes}`);
    } catch (e) {
      fail(path, e.message);
    }
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${records.length} records OK${args.has("--offline") ? " (S1 only)" : " (S1, S4)"}`);
