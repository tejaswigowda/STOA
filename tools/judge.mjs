#!/usr/bin/env node
// The naming judge's two ends (recovery work order C3). The judging itself is a model or a person
// working from tools/judge-brief.md; this prepares what they see and merges what they say.
//
//   node tools/judge.mjs pairs  results.jsonl [--out pairs.jsonl]    matched Tier A pairs awaiting a verdict
//   node tools/judge.mjs apply  results.jsonl verdicts.jsonl         write verdicts into the results, in place
//   node tools/judge.mjs consensus out.jsonl a.jsonl b.jsonl [c.jsonl]   majority of independent judges, with agreement (Cohen's kappa of the first two)
//   node tools/judge.mjs label  results.jsonl labels.jsonl           add named|descriptive to every recovered name
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

/** Majority of the judges for each key. Two judges must be complete; a later judge may cover only the keys the first two split. */
export function consensus(sets) {
  const by = new Map();
  for (const set of sets) for (const v of set) {
    if (!VERDICTS.includes(v.verdict)) throw new Error(`${v.key}: verdict "${v.verdict}" is not one of ${VERDICTS.join(" | ")}`);
    by.set(v.key, [...(by.get(v.key) ?? []), v]);
  }
  const out = [];
  for (const [key, votes] of by) {
    const tally = {};
    for (const v of votes) tally[v.verdict] = (tally[v.verdict] ?? 0) + 1;
    const [[verdict, n]] = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (n * 2 <= votes.length) throw new Error(`${key}: no majority among ${votes.map((v) => v.verdict).join(", ")}`);
    out.push({ key, verdict, votes: votes.map((v) => v.verdict), reason: votes.find((v) => v.verdict === verdict).reason });
  }
  return out;
}

export function agreement(a, b) {
  const cats = VERDICTS, n = a.length;
  const agree = a.filter((x, i) => x.verdict === b[i].verdict).length;
  const pe = cats.reduce((s, c) => s + (a.filter((x) => x.verdict === c).length / n) * (b.filter((x) => x.verdict === c).length / n), 0);
  const pa = agree / n;
  return { n, agree, observed: pa, kappa: (pa - pe) / (1 - pe), same_or_grain_agree: a.filter((x, i) => (x.verdict === "wrong") === (b[i].verdict === "wrong")).length };
}

/** Add `recovered_label` (named | descriptive) to every row that carries a recovered name. */
export function labelNames(rows, labels) {
  const by = new Map(labels.map((l) => [l.name, l.label]));
  for (const r of rows) {
    if (r.recovered_name == null) continue;
    if (!by.has(r.recovered_name)) throw new Error(`no label for recovered name "${r.recovered_name}"`);
    r.recovered_label = by.get(r.recovered_name);
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
  } else if (cmd === "consensus" && positionals.length >= 4) {
    const [, out, ...files] = positionals;
    const sets = await Promise.all(files.map(readJsonl));
    const agr = agreement(sets[0], sets[1]);
    await writeFile(out, consensus(sets).map((v) => JSON.stringify(v)).join("\n") + "\n");
    console.log(JSON.stringify(agr));
  } else if (cmd === "label" && results && verdicts) {
    await writeFile(results, labelNames(await readJsonl(results), await readJsonl(verdicts)).map((r) => JSON.stringify(r)).join("\n") + "\n");
  } else {
    console.error("usage: judge.mjs pairs <results.jsonl> [--out pairs.jsonl] | judge.mjs apply <results.jsonl> <verdicts.jsonl>");
    process.exit(2);
  }
}
