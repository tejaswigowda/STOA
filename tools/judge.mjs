#!/usr/bin/env node
// The naming judge's two ends (recovery work order C3). The judging itself is a model or a person
// working from tools/judge-brief.md; this prepares what they see and merges what they say.
//
//   node tools/judge.mjs pairs  results.jsonl [--out pairs.jsonl]    matched Tier A pairs awaiting a verdict
//   node tools/judge.mjs apply  results.jsonl verdicts.jsonl         write verdicts into the results, in place
//
// A pair shows the authored name with its instance index already stripped, and the recovered name.
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

export const VERDICTS = ["same", "grain", "wrong"];
export const pairKey = (r) => `${r.model}#${r.part}`;

const readJsonl = async (f) => (await readFile(f, "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

export const pending = (rows) => rows.filter((r) => r.kind === "original" && "verdict" in r && r.verdict === null);

export function toPairs(rows) {
  return pending(rows).map((r) => ({ key: pairKey(r), model: r.model, authored: r.name_stripped, recovered: r.recovered_name }));
}

/** Merge verdicts into the rows. Refuses a verdict that is not one of the three, a pair that is not awaiting one, and a pair left out. */
export function applyVerdicts(rows, verdicts) {
  const by = new Map();
  for (const v of verdicts) {
    if (!VERDICTS.includes(v.verdict)) throw new Error(`${v.key}: verdict "${v.verdict}" is not one of ${VERDICTS.join(" | ")}`);
    by.set(v.key, v);
  }
  const awaiting = new Map(pending(rows).map((r) => [pairKey(r), r]));
  for (const k of by.keys()) if (!awaiting.has(k)) throw new Error(`${k}: no such pair awaiting a verdict`);
  for (const k of awaiting.keys()) if (!by.has(k)) throw new Error(`${k}: no verdict given`);
  for (const [k, r] of awaiting) {
    r.verdict = by.get(k).verdict;
    if (by.get(k).reason) r.verdict_reason = by.get(k).reason;
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
  const [cmd, results, verdicts] = positionals;
  if (cmd === "pairs" && results) {
    const text = toPairs(await readJsonl(results)).map((p) => JSON.stringify(p)).join("\n") + "\n";
    if (values.out) await writeFile(values.out, text);
    else process.stdout.write(text);
  } else if (cmd === "apply" && results && verdicts) {
    const rows = applyVerdicts(await readJsonl(results), await readJsonl(verdicts));
    await writeFile(results, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`applied ${(await readJsonl(verdicts)).length} verdicts`);
  } else {
    console.error("usage: judge.mjs pairs <results.jsonl> [--out pairs.jsonl] | judge.mjs apply <results.jsonl> <verdicts.jsonl>");
    process.exit(2);
  }
}
