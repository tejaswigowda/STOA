import test from "node:test";
import assert from "node:assert/strict";
import { buildGlb, hasIndex, parseGlb, stripIndex, tierGroundTruth } from "./lib.mjs";
import { flatten, flattenedTriangles, measure } from "./flatten.mjs";
import { scoreStructure, toRecords, triangleAreas } from "./score.mjs";
import { aggregate, modelScores } from "./report.mjs";
import { applyVerdicts, toPairs } from "./judge.mjs";
import { checkMeshOrder, scoreRecords } from "./recovery-run.mjs";
import { findRecord, recoveredFromRecord, recoveredFromRecords } from "./recovered-from-record.mjs";

// Two unit right triangles (area 0.5 each) in the XY plane, indexed, one material each.
function twoPartGlb({ translateB = [3, 0, 0], scaleB = [1, 1, 1], sharedMaterial = false } = {}) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const idx = new Uint16Array([0, 1, 2, 0]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    materials: [{ name: "a" }, { name: "b" }],
    meshes: [
      { name: "tri_a", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] },
      { name: "tri_b", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: sharedMaterial ? 0 : 1 }] },
    ],
    nodes: [{ name: "A", mesh: 0 }, { name: "B", mesh: 1, translation: translateB, scale: scaleB }],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
  };
  return buildGlb(json, bin);
}

test("flatten keeps triangles, area and bbox, and locates every part by triangle index", () => {
  const { glb, key } = flatten(twoPartGlb());
  assert.equal(key.gate.passed, true);
  assert.equal(key.flattened.triangles, 2);
  assert.deepEqual(key.parts.map((p) => [p.name, p.triangles.length]), [["A", 1], ["B", 1]]);
  assert.deepEqual(key.flattened.groups.map((g) => g.material), [0, 1]);
  const tris = flattenedTriangles(glb);
  assert.equal(measure(tris).area, 1);
  assert.deepEqual(key.parts[1].bbox.min, [3, 0, 0]);
});

test("a negative-scale instance keeps its triangle and has its winding flipped", () => {
  const { glb, key } = flatten(twoPartGlb({ scaleB: [-1, 1, 1] }));
  assert.equal(key.gate.passed, true);
  const [a, b, c] = flattenedTriangles(glb)[1];
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  assert.ok(cross > 0, "still counter-clockwise (facing +Z) after mirroring");
});

test("--mode=single merges one-material assets and refuses the rest", () => {
  const { key } = flatten(twoPartGlb({ sharedMaterial: true }), { mode: "single" });
  assert.equal(key.flattened.groups.length, 1);
  assert.deepEqual(key.parts.map((p) => p.triangles), [[0], [1]]);
  assert.throws(() => flatten(twoPartGlb(), { mode: "single" }), /atlasing/);
});

test("skinned and morphed assets are refused", () => {
  const { json, bin } = parseGlb(twoPartGlb());
  const skinned = buildGlb({ ...json, skins: [{ joints: [0] }] }, bin);
  assert.throws(() => flatten(skinned), /skinned/);
});

test("scoring: identity recovery scores 1; a merge and a split are visible", () => {
  const { glb, key } = flatten(twoPartGlb());
  const areas = triangleAreas(glb);
  const identity = [{ id: "r0", name: "A", triangles: [0] }, { id: "r1", name: "B", triangles: [1] }];
  const s = scoreStructure(key.parts, areas, identity);
  assert.equal(s.summary.mean_best_iou, 1);
  assert.equal(s.summary.recovery_rate, 1);
  assert.equal(s.summary.part_count_ratio, 1);

  const merged = scoreStructure(key.parts, areas, [{ id: "m", name: null, triangles: [0, 1] }]);
  assert.equal(merged.summary.mean_best_iou, 0.5); // 0.5 / 1.0 for each original
  assert.equal(merged.summary.part_count_ratio, 0.5);
  assert.equal(merged.reverse[0].best_iou, 0.5);

  const missing = scoreStructure(key.parts, areas, [{ id: "r0", name: "A", triangles: [0] }]);
  assert.equal(missing.forward[1].recovered, -1);

  assert.throws(() => scoreStructure(key.parts, areas, [{ id: "x", triangles: [0] }, { id: "y", triangles: [0] }]), /power of 4/);
  assert.throws(() => scoreStructure(key.parts, areas, [{ id: "x", triangles: [9] }]), /not a triangle/);
});

test("scoring is exact when SEG subdivides: one parent triangle spread over several parts", () => {
  const { glb, key } = flatten(twoPartGlb());
  const areas = triangleAreas(glb); // two triangles of area 0.5
  // triangle 0 cut into 4 children (3 to X, 1 to Y); triangle 1 left whole in X
  const recovered = [{ id: "X", name: "x", triangles: [0, 0, 0, 1] }, { id: "Y", name: "y", triangles: [0] }];
  const s = scoreStructure(key.parts, areas, recovered);
  assert.equal(s.forward[0].recovered, 0);
  assert.ok(Math.abs(s.forward[0].best_iou - 0.375) < 1e-12); // 0.375 / (0.5 + 0.875 - 0.375)
  assert.ok(Math.abs(s.forward[1].best_iou - 0.5 / 0.875) < 1e-12); // B is whole inside X: 0.5 / (0.5 + 0.875 - 0.5)
  assert.equal(s.summary.uncovered_area_share, 0);
  assert.ok(Math.abs(s.reverse[1].best_iou - 0.25) < 1e-12); // Y is a quarter of triangle 0
});

test("index stripping is one trailing group, and leaves a type number alone", () => {
  assert.deepEqual(["Bishop_B1", "build05-08", "build05", "car-11", "bridg-ll-04", "Wheels.001", "skscr01", "Box02", "01", "Lantern"].map(stripIndex),
    ["Bishop_B", "build05", "build05", "car", "bridg-ll", "Wheels", "skscr01", "Box02", "01", "Lantern"]);
  assert.equal(hasIndex("Bishop_B1"), true);
  assert.equal(hasIndex("skscr01"), false);
});

test("score records say no-name (declined) apart from unmatched; only named Tier A pairs await a verdict", () => {
  const { glb, key } = flatten(twoPartGlb());
  const recovered = [{ id: "m", name: null, triangles: [0, 1] }];
  const result = scoreStructure(key.parts, triangleAreas(glb), recovered);
  const rows = toRecords({ meta: {}, model: "t", id: "i", tier: "A", mode: "materials", parts: key.parts, recovered, result });
  const originals = rows.filter((r) => r.kind === "original");
  assert.deepEqual(originals.map((r) => r.failure), ["no-name", "no-name"]); // IoU 0.5 meets the threshold; SEG declined to name it
  const missing = toRecords({ meta: {}, model: "t", id: "i", tier: "A", mode: "materials", parts: key.parts, recovered: [{ id: "r0", name: "A", triangles: [0] }],
    result: scoreStructure(key.parts, triangleAreas(glb), [{ id: "r0", name: "A", triangles: [0] }]) });
  assert.equal(missing.find((r) => r.part === 1 && r.kind === "original").failure, "unmatched");
  const exact = [{ id: "r0", name: null, triangles: [0] }, { id: "r1", name: "B", triangles: [1] }];
  const rows2 = toRecords({ meta: {}, model: "t", id: "i", tier: "A", mode: "materials", parts: key.parts, recovered: exact, result: scoreStructure(key.parts, triangleAreas(glb), exact) });
  assert.equal(rows2[0].failure, "no-name");
  assert.ok(!("verdict" in rows2[0]));
  assert.equal(rows2[1].verdict, null);
});

test("tiering: generic names are tier C, curated feature tests are B, the rest A", () => {
  const none = new Set();
  assert.equal(tierGroundTruth(["body_1", "body_2", "body_3"], "x", none).tier, "C");
  assert.equal(tierGroundTruth(["Wheels", "Body"], "x", none).tier, "A");
  assert.equal(tierGroundTruth(["Wheels", "Body"], "x", new Set(["x"])).tier, "B");
  assert.equal(tierGroundTruth(["Only"], "x", none).tier, "C");
  assert.equal(tierGroundTruth(["g_m0%_r16%", "Sphere.098"], "x", none).nameQuality, 0);
});

const orig = (model, tier, part, extra) => ({ kind: "original", model, tier, mode: "materials", part, name: `p${part}`, name_stripped: `p${part}`, index_bearing: false, best_iou: 1, matched: true, failure: null, recovered_name: `p${part}`, ...extra });
const rec = (model, tier, best_iou = 1) => ({ kind: "recovered", model, tier, mode: "materials", best_iou, failure: null });

test("macro weights models equally, micro weights parts: one big model moves micro, not macro", () => {
  const big = Array.from({ length: 9 }, (_, i) => orig("Big", "B", i, { best_iou: 0, matched: false, failure: "below-threshold" })).concat(Array.from({ length: 9 }, () => rec("Big", "B", 0)));
  const small = [orig("Small", "B", 0), rec("Small", "B")];
  const models = [modelScores(big), modelScores(small)];
  const agg = aggregate(models);
  assert.equal(agg.structure.macro.mean_best_iou, 0.5);
  assert.equal(agg.structure.micro.mean_best_iou, 0.1);
  assert.equal(agg.structure.micro.parts, 10);
  assert.equal(agg.naming, null, "naming is Tier A only");
});

test("naming keeps unmatched in the denominator, reports the index-bearing share, and withholds rates until every pair is judged", () => {
  const rows = [
    orig("M", "A", 0, { verdict: null, index_bearing: true }),
    orig("M", "A", 1, { verdict: "grain" }),
    orig("M", "A", 2, { matched: false, failure: "unmatched", best_iou: 0, recovered_name: null }),
    orig("M", "A", 3, { failure: "no-name", recovered_name: null }),
    rec("M", "A"), rec("M", "A"),
  ];
  const n = modelScores(rows).naming;
  assert.deepEqual([n.parts, n.pending, n.grain, n.unmatched, n["no-name"], n.index_bearing], [4, 1, 1, 1, 1, 1]);
  assert.equal(n.same_rate, null);
  assert.equal(aggregate([modelScores(rows)]).naming.macro, null);

  const judged = applyVerdicts(rows, [{ key: "M#0", verdict: "same", reason: "skscr = skyscraper" }]);
  const n2 = modelScores(judged).naming;
  assert.equal(n2.same_rate, 0.25);
  assert.equal(n2.same_or_grain_rate, 0.5);
});

test("the judge sees the stripped authored name; verdicts must be one of three and cover every pair", () => {
  const rows = [orig("M", "A", 0, { name: "Bishop_B1", name_stripped: "Bishop_B", verdict: null }), orig("M", "A", 1)];
  assert.deepEqual(toPairs(rows), [{ key: "M#0", model: "M", authored: "Bishop_B", recovered: "p0" }]);
  assert.throws(() => applyVerdicts(rows, [{ key: "M#0", verdict: "right" }]), /not one of/);
  assert.throws(() => applyVerdicts(rows, []), /no verdict given/);
  assert.throws(() => applyVerdicts(rows, [{ key: "M#9", verdict: "same" }]), /no such pair/);
});

test("recovered.json comes from the record's parents, and a record without them is refused, not approximated", () => {
  const record = { seg_version: "1.5.0", method: "islands", source: { sha256: "ab" }, parts: { A_Part: 2, B_Part: 1 }, parents: { A_Part: [0, 0], B_Part: [1] } };
  const r = recoveredFromRecord(findRecord({ scene: { object: { children: [{ userData: { segmentation: record } }] } } }));
  assert.deepEqual(r.parts, [{ id: "A_Part", name: "A_Part", triangles: [0, 0] }, { id: "B_Part", name: "B_Part", triangles: [1] }]);
  assert.equal(r.source_sha256, "ab");
  assert.throws(() => recoveredFromRecord({ ...record, seg_version: "1.4.0" }), /parent triangles need 1\.5\.0/);
  assert.throws(() => recoveredFromRecord({ ...record, parents: { A_Part: [0], B_Part: [1] } }), /1 parents for 2 triangles/);
});

test("one record per primitive: parents are offset into the flattened mesh by the group's first triangle", () => {
  const rec = (parts, parents) => ({ seg_version: "1.5.0", method: "material", parts, parents });
  const a = rec({ Wall_Part: 2 }, { Wall_Part: [0, 1] });
  const b = rec({ Floor_Part: 1 }, { Floor_Part: [0] });
  const r = recoveredFromRecords([a, b], [{ triangleStart: 0 }, { triangleStart: 2 }]);
  assert.deepEqual(r.parts.map((p) => [p.id, p.triangles]), [["Wall_Part", [0, 1]], ["Floor_Part", [2]]]);
  assert.throws(() => recoveredFromRecords([a], [{ triangleStart: 0 }, { triangleStart: 2 }]), /2 primitives/);
  assert.throws(() => recoveredFromRecords([a, a], [{ triangleStart: 0 }, { triangleStart: 2 }]), /used by two records/);
});

// N2: the offset is the one place geometry can re-enter a path built to exclude it. A scorer that cannot fail is not a scorer.
function twoMeshes() {
  const { glb: flat, key } = flatten(twoPartGlb()); // two primitives of one triangle each, areas 0.5 and 0.5
  const identity = (parts) => ({ seg_version: "1.5.0", method: "islands", parts: Object.fromEntries(parts.map((p) => [p, 1])), parents: Object.fromEntries(parts.map((p) => [p, [0]])) });
  return { flat, key, records: [identity(["A_Part"]), identity(["B_Part"])] };
}

test("N2: right offsets score 1.0; a wrong offset is caught by the pairs when sizes match, by the score when they differ, and refused when they overlap", () => {
  const { flat, key, records } = twoMeshes();
  const ok = scoreRecords({ key, flat, records }).result;
  assert.ok(ok.summary.mean_best_iou > 1 - 1e-12 && ok.summary.recovery_rate === 1);
  const pairs = (result, recovered) => toRecords({ meta: {}, model: "t", id: "i", tier: "A", mode: "materials", parts: key.parts, recovered, result }).filter((r) => r.kind === "original").map((r) => [r.name, r.recovered_name]);
  assert.deepEqual(pairs(ok, scoreRecords({ key, flat, records }).recovered.parts), [["A", "A_Part"], ["B", "B_Part"]]);

  // equal-size meshes in the other order: the partition is valid and structure-only scoring is label-blind, so it still reads 1.0 ...
  const swapped = key.flattened.groups.map((g) => ({ ...g }));
  [swapped[0].triangleStart, swapped[1].triangleStart] = [swapped[1].triangleStart, swapped[0].triangleStart];
  const s = scoreRecords({ key, flat, records, offsetGroups: swapped });
  assert.ok(s.result.summary.mean_best_iou > 1 - 1e-12);
  // ... but every pair is crossed, which is what the naming verdict sees
  assert.deepEqual(pairs(s.result, s.recovered.parts), [["A", "B_Part"], ["B", "A_Part"]]);

  const overlapping = key.flattened.groups.map((g) => ({ ...g, triangleStart: 0 }));
  assert.throws(() => scoreRecords({ key, flat, records, offsetGroups: overlapping }), /power of 4/);
});

test("the importer's meshes must be the primitives in order: same triangle count is not enough, the surface must match", () => {
  const { flat, key } = twoMeshes();
  const areas = triangleAreas(flat);
  const good = [{ triangles: 1, area: areas[0] }, { triangles: 1, area: areas[1] }];
  assert.doesNotThrow(() => checkMeshOrder(good, key, areas));
  assert.throws(() => checkMeshOrder([good[0]], key, areas), /1 meshes for 2/);
  assert.throws(() => checkMeshOrder([{ triangles: 2, area: 1 }, good[1]], key, areas), /not in primitive order/);
  assert.throws(() => checkMeshOrder([{ triangles: 1, area: areas[0] * 1.01 }, good[1]], key, areas), /surface area/);
});
