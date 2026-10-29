import test from "node:test";
import assert from "node:assert/strict";
import { buildGlb, parseGlb, tierGroundTruth } from "./lib.mjs";
import { flatten, flattenedTriangles, measure } from "./flatten.mjs";
import { scoreStructure, toRecords, triangleAreas } from "./score.mjs";

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

  assert.throws(() => scoreStructure(key.parts, areas, [{ id: "x", triangles: [0] }, { id: "y", triangles: [0] }]), /overlap/);
  assert.throws(() => scoreStructure(key.parts, areas, [{ id: "x", triangles: [9] }]), /out of range/);
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
