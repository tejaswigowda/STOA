// The numbers behind the report and the site: per-model scores, macro and micro aggregates, the residual after the
// material boundary. No I/O; tools/report.mjs prints them and tools/page.mjs renders them.
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const share = (n, d) => (d ? n / d : null);

export const VERDICTS = ["same", "grain", "wrong", "abstained"];

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
    const n = { same: 0, grain: 0, wrong: 0, abstained: 0, pending: 0, unmatched: 0, "below-threshold": 0, "no-name": 0 };
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
      named_same_or_grain: named.filter((r) => r.verdict === "same" || r.verdict === "grain").length,
      named_wrong: named.filter((r) => r.verdict === "wrong").length,
      descriptive_pairs: abstained.length,
      descriptive_same_or_grain: abstained.filter((r) => r.verdict === "same" || r.verdict === "grain").length,
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
        parts: a.length, same: v((r) => r.verdict === "same"), grain: v((r) => r.verdict === "grain"), wrong: v((r) => r.verdict === "wrong"), abstained: v((r) => r.verdict === "abstained"),
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

