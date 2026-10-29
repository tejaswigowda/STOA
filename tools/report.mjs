#!/usr/bin/env node
// Aggregate recovery results (recovery work order, part C).
//
//   node tools/report.mjs results/recovery.jsonl [more.jsonl ...] [--mode materials] [--json]
//
// Macro is the headline: the mean of per-model scores, every model weighted equally. Micro pools
// every part and so weights by part count; on Tier A two models (VC, ABeautifulGame) are most of
// the parts, so micro describes the corpus and macro describes the method. Both are printed, with
// every per-model row, and with the index-bearing share of the naming denominator.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const share = (n, d) => (d ? n / d : null);

export const VERDICTS = ["same", "grain", "wrong"];

/** Per-model structure and naming numbers from the rows of one model (one mode). */
export function modelScores(rows) {
  const orig = rows.filter((r) => r.kind === "original");
  const rec = rows.filter((r) => r.kind === "recovered");
  const first = orig[0] ?? rec[0];
  const out = {
    model: first.model, tier: first.tier, mode: first.mode,
    structure: {
      parts: orig.length,
      mean_best_iou: mean(orig.map((r) => r.best_iou)),
      recovery_rate: share(orig.filter((r) => r.matched).length, orig.length),
      part_count_ratio: share(rec.length, orig.length),
      mean_reverse_best_iou: mean(rec.map((r) => r.best_iou)),
    },
  };
  if (first.tier === "A") {
    const n = { same: 0, grain: 0, wrong: 0, pending: 0, unmatched: 0, "below-threshold": 0, "no-name": 0 };
    for (const r of orig) {
      if (r.failure) n[r.failure]++;
      else if (VERDICTS.includes(r.verdict)) n[r.verdict]++;
      else n.pending++;
    }
    // a "wrong" against a descriptive recovered name is an abstention scored by the three-way rule; against a named one it is a wrong name
    const named = orig.filter((r) => r.verdict && r.recovered_label === "named");
    const abstained = orig.filter((r) => r.verdict && r.recovered_label === "descriptive");
    const judged = n.pending === 0;
    const indexed = orig.filter((r) => r.index_bearing).length;
    out.naming = {
      parts: orig.length, ...n,
      judged_pairs: orig.filter((r) => r.verdict).length,
      named_pairs: named.length,
      named_same_or_grain: named.filter((r) => r.verdict !== "wrong").length,
      named_wrong: named.filter((r) => r.verdict === "wrong").length,
      descriptive_pairs: abstained.length,
      descriptive_same_or_grain: abstained.filter((r) => r.verdict !== "wrong").length,
      index_bearing: indexed,
      index_bearing_share: share(indexed, orig.length),
      // unmatched, below-threshold and no-name stay in the denominator: they are naming failures too
      same_rate: judged ? share(n.same, orig.length) : null,
      same_or_grain_rate: judged ? share(n.same + n.grain, orig.length) : null,
    };
  }
  return out;
}

/**
 * Structure on the parts the material boundary does NOT hand over exactly. `handover` is results/material-name-overlap.json:
 * { models: { name: { exact_parts: [part indices that are exactly one material mesh] } } }.
 * The importer recovers the others before SEG runs, so this residual is the part of the score that is SEG's.
 */
export function residualStructure(rows, handover) {
  const by = new Map();
  for (const r of rows.filter((x) => x.kind === "original")) {
    const exact = new Set(handover.models[r.model]?.exact_parts ?? []);
    if (exact.has(r.part)) continue;
    if (!by.has(r.model)) by.set(r.model, []);
    by.get(r.model).push(r);
  }
  const per = [...by].map(([model, rs]) => ({ model, parts: rs.length, mean_best_iou: mean(rs.map((r) => r.best_iou)), recovery_rate: share(rs.filter((r) => r.matched).length, rs.length) }));
  const all = [...by.values()].flat();
  return {
    models: per.length, parts: all.length,
    macro: { mean_best_iou: mean(per.map((p) => p.mean_best_iou)), recovery_rate: mean(per.map((p) => p.recovery_rate)) },
    micro: { mean_best_iou: mean(all.map((r) => r.best_iou)), recovery_rate: share(all.filter((r) => r.matched).length, all.length) },
    per_model: per,
    naming: (() => {
      const a = all.filter((r) => r.tier === "A");
      const v = (x) => a.filter((r) => x(r)).length;
      return {
        parts: a.length, same: v((r) => r.verdict === "same"), grain: v((r) => r.verdict === "grain"), wrong: v((r) => r.verdict === "wrong"),
        unmatched_or_below: v((r) => r.failure === "unmatched" || r.failure === "below-threshold"), no_name: v((r) => r.failure === "no-name"),
        named: v((r) => r.verdict && r.recovered_label === "named"), named_wrong: v((r) => r.verdict === "wrong" && r.recovered_label === "named"),
      };
    })(),
  };
}

export function aggregate(models) {
  const m = (xs, f) => mean(xs.map(f).filter((v) => v !== null));
  const structure = models.map((x) => x.structure);
  const naming = models.filter((x) => x.naming).map((x) => x.naming);
  const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  const parts = sum(structure, "parts") || 1;
  const judged = naming.length > 0 && naming.every((n) => n.same_rate !== null);
  return {
    structure: {
      models: models.length,
      macro: {
        mean_best_iou: m(structure, (s) => s.mean_best_iou), recovery_rate: m(structure, (s) => s.recovery_rate),
        part_count_ratio: m(structure, (s) => s.part_count_ratio), mean_reverse_best_iou: m(structure, (s) => s.mean_reverse_best_iou),
      },
      micro: {
        parts: sum(structure, "parts"),
        mean_best_iou: structure.reduce((a, s) => a + s.mean_best_iou * s.parts, 0) / parts,
        recovery_rate: structure.reduce((a, s) => a + s.recovery_rate * s.parts, 0) / parts,
      },
    },
    naming: naming.length === 0 ? null : {
      models: naming.length,
      parts: sum(naming, "parts"),
      index_bearing: sum(naming, "index_bearing"),
      index_bearing_share: share(sum(naming, "index_bearing"), sum(naming, "parts")),
      pending: sum(naming, "pending"),
      judged_pairs: sum(naming, "judged_pairs"),
      named_pairs: sum(naming, "named_pairs"),
      named_same_or_grain: sum(naming, "named_same_or_grain"),
      named_wrong: sum(naming, "named_wrong"),
      descriptive_pairs: sum(naming, "descriptive_pairs"),
      descriptive_same_or_grain: sum(naming, "descriptive_same_or_grain"),
      macro: judged ? { same_rate: m(naming, (n) => n.same_rate), same_or_grain_rate: m(naming, (n) => n.same_or_grain_rate) } : null,
      micro: judged ? { same_rate: sum(naming, "same") / sum(naming, "parts"), same_or_grain_rate: (sum(naming, "same") + sum(naming, "grain")) / sum(naming, "parts") } : null,
      largest_model_share: Math.max(...naming.map((n) => n.parts)) / (sum(naming, "parts") || 1),
    },
  };
}

const pct = (v) => (v === null || v === undefined ? "-" : (100 * v).toFixed(1) + "%");
const num = (v) => (v === null || v === undefined ? "-" : v.toFixed(3));

export function toMarkdown(models, agg, mode, residual = null, handover = null) {
  const L = [`# Recovery results (${mode})`, ""];
  L.push("Khronos is an upper bound: hand-built, carefully unwrapped, small." + (mode === "materials" ? " `--mode materials` is the ceiling test (material boundaries are handed over), not the production case." : ""), "");
  L.push("## Structure (all models)", "", "| | models | mean best IoU | recovery rate | part-count ratio | reverse IoU |", "|---|--:|--:|--:|--:|--:|");
  const s = agg.structure;
  L.push(`| **macro** (headline) | ${s.models} | ${num(s.macro.mean_best_iou)} | ${pct(s.macro.recovery_rate)} | ${num(s.macro.part_count_ratio)} | ${num(s.macro.mean_reverse_best_iou)} |`);
  L.push(`| micro (${s.micro.parts} parts pooled) | ${s.models} | ${num(s.micro.mean_best_iou)} | ${pct(s.micro.recovery_rate)} | | |`, "");
  L.push("| model | tier | parts | mean best IoU | recovery rate | part-count ratio | reverse IoU |", "|---|:-:|--:|--:|--:|--:|--:|");
  for (const x of models) L.push(`| ${x.model} | ${x.tier ?? "-"} | ${x.structure.parts} | ${num(x.structure.mean_best_iou)} | ${pct(x.structure.recovery_rate)} | ${num(x.structure.part_count_ratio)} | ${num(x.structure.mean_reverse_best_iou)} |`);
  if (residual && handover) {
    const t = handover.total;
    L.push("", "## What the material boundary hands over", "",
      `${t.exact_by_material} of ${t.parts} original parts (${pct(t.exact_share)}) are exactly one material's mesh, so the importer recovers them before SEG runs (Tier A: ${t.tier_a.exact_by_material} of ${t.tier_a.parts}, ${pct(t.tier_a.exact_share)}). In Tier A, ${t.tier_a.overlapping} of ${t.tier_a.parts} authored part names (${pct(t.tier_a.overlap_share)}) also share a word with their material's name (an upper bound). The scores above include those parts. **On the ${residual.parts} parts the boundary does not hand over** (${residual.models} models) the structure scores are:`, "",
      "| | models | mean best IoU | recovery rate |", "|---|--:|--:|--:|",
      `| macro | ${residual.models} | ${num(residual.macro.mean_best_iou)} | ${pct(residual.macro.recovery_rate)} |`,
      `| micro (${residual.parts} parts) | ${residual.models} | ${num(residual.micro.mean_best_iou)} | ${pct(residual.micro.recovery_rate)} |`, "",
      `Tier A residual naming: ${residual.naming.parts} parts, ${residual.naming.same} same, ${residual.naming.grain} grain, ${residual.naming.wrong} wrong (${residual.naming.named_wrong} of them against a named part), ${residual.naming.unmatched_or_below} unmatched or below the IoU threshold.`);
  }
  if (agg.naming) {
    const n = agg.naming;
    L.push("", "## Naming (Tier A only)", "");
    L.push(`${n.parts} parts across ${n.models} models. Instance indices are stripped from authored names before comparison; **${n.index_bearing} of ${n.parts} parts (${pct(n.index_bearing_share)}) carry one**, so the naming score rests on what remains. The largest model is ${pct(n.largest_model_share)} of the parts.`, "");
    if (n.pending) L.push(`**${n.pending} matched pairs have no judge verdict yet; naming rates are not reported until every pair is judged.**`, "");
    else L.push("| | same | same or grain |", "|---|--:|--:|", `| **macro** (headline) | ${pct(n.macro.same_rate)} | ${pct(n.macro.same_or_grain_rate)} |`, `| micro | ${pct(n.micro.same_rate)} | ${pct(n.micro.same_or_grain_rate)} |`, "");
    if (n.judged_pairs) {
      L.push(`Of ${n.judged_pairs} matched pairs, SEG's plan **named** the part (claimed what it is) in ${n.named_pairs} and **described** it (abstained: shape, colour, position) in ${n.descriptive_pairs}. When it named: ${n.named_same_or_grain} same-or-grain, ${n.named_wrong} wrong (${pct(n.named_pairs ? n.named_same_or_grain / n.named_pairs : null)} right). When it only described: ${n.descriptive_same_or_grain} same-or-grain. Abstentions are scored wrong by the three-way rule and reported here so they are not read as wrong names.`, "");
    }
    L.push("| model | parts | index-bearing | same | grain | wrong | unmatched | below-threshold | no-name | pending | same rate |", "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
    for (const x of models.filter((y) => y.naming)) {
      const k = x.naming;
      L.push(`| ${x.model} | ${k.parts} | ${k.index_bearing} (${pct(k.index_bearing_share)}) | ${k.same} | ${k.grain} | ${k.wrong} | ${k.unmatched} | ${k["below-threshold"]} | ${k["no-name"]} | ${k.pending} | ${pct(k.same_rate)} |`);
    }
  }
  return L.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { mode: { type: "string", default: "materials" }, json: { type: "boolean", default: false }, handover: { type: "string" } } });
  if (!positionals.length) {
    console.error("usage: report.mjs <results.jsonl>... [--mode materials] [--json]");
    process.exit(2);
  }
  const rows = [];
  for (const f of positionals) for (const line of (await readFile(f, "utf8")).split("\n")) if (line.trim()) rows.push(JSON.parse(line));
  const byModel = new Map();
  for (const r of rows.filter((x) => x.mode === values.mode)) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  const models = [...byModel.values()].map(modelScores).sort((a, b) => a.model.localeCompare(b.model));
  const agg = aggregate(models);
  const handover = values.handover ? JSON.parse(await readFile(values.handover, "utf8")) : null;
  const residual = handover ? residualStructure(rows.filter((x) => x.mode === values.mode), handover) : null;
  process.stdout.write(values.json ? JSON.stringify({ mode: values.mode, models, ...agg, residual }, null, 2) + "\n" : toMarkdown(models, agg, values.mode, residual, handover));
}
