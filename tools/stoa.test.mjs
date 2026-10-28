import test from "node:test";
import assert from "node:assert/strict";
import { assertPackPreserved, buildGlb, classify, idFromSha256, packToGlb, parseGlb, recordPath, summarise } from "./lib.mjs";
import { buildIndex } from "./build-index.mjs";

test("ids and sharding follow the work order examples", () => {
  const duck = "65bf938f54d6073e619e76e007820bbf980cdc3dc0daec0d94830ffc4ae54ab5";
  assert.equal(idFromSha256(duck), "65bf938f54d6073e");
  assert.equal(recordPath("65bf938f54d6073e"), "objects/65/65bf938f54d6073e.json");
  assert.equal(recordPath("65bf938f54d6073e-2"), "objects/65/65bf938f54d6073e-2.json");
});

test("classify: refusals win, then ground truth, hard, no evidence", () => {
  const base = { meshes: 1, materials: 1, skinned: false, morphTargets: false, hasUVs: true, hasBaseColourTexture: true, partNames: ["a"] };
  assert.equal(classify({ ...base, skinned: true, meshes: 5, partNames: ["a", "b"] }).bucket, "refused");
  assert.equal(classify({ ...base, morphTargets: true }).reason, "morph-targets");
  assert.equal(classify({ ...base, meshes: 2, partNames: ["a", "b"] }).bucket, "ground-truth");
  assert.equal(classify({ ...base, meshes: 2, partNames: ["a"] }).bucket, "hard");
  assert.equal(classify(base).bucket, "hard");
  assert.equal(classify({ ...base, hasUVs: false }).bucket, "no-evidence");
});

test("packing a .gltf to .glb preserves counts and rewrites buffers and images", async () => {
  const gltf = {
    asset: { version: "2.0" },
    buffers: [{ uri: "a.bin", byteLength: 6 }, { uri: "b.bin", byteLength: 4 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 6 }, { buffer: 1, byteOffset: 0, byteLength: 4 }],
    accessors: [{ bufferView: 0, componentType: 5123, count: 3, type: "SCALAR" }, { bufferView: 1, componentType: 5126, count: 1, type: "SCALAR" }],
    images: [{ uri: "t.png" }],
    meshes: [{ name: "left", primitives: [{ attributes: { POSITION: 1 }, indices: 0 }] }, { name: "right", primitives: [{ attributes: { POSITION: 1 } }] }],
    materials: [{}, {}],
    nodes: [{ mesh: 0, name: "left" }, { mesh: 1, name: "right" }],
  };
  const files = { "a.bin": Buffer.from([1, 2, 3, 4, 5, 6]), "b.bin": Buffer.from([7, 8, 9, 10]), "t.png": Buffer.from([0x89, 0x50]) };
  const { glb } = await packToGlb(gltf, async (uri) => files[uri]);
  const { json, bin } = parseGlb(glb);
  assertPackPreserved(summarise(gltf), summarise(json));
  assert.equal(json.buffers.length, 1);
  assert.equal(json.buffers[0].uri, undefined);
  assert.equal(json.images[0].mimeType, "image/png");
  assert.equal(json.bufferViews[1].byteOffset, 8); // a.bin padded to 4
  assert.deepEqual([...bin.subarray(8, 12)], [7, 8, 9, 10]);
  assert.deepEqual(glb, (await packToGlb(gltf, async (uri) => files[uri])).glb);
  assert.deepEqual(parseGlb(buildGlb({ asset: { version: "2.0" } }, null)).json, { asset: { version: "2.0" } });
});

test("assertPackPreserved rejects a merging packer", () => {
  const a = { meshes: 2, materials: 2, primitives: 2, nodes: 2, triangles: 4, partNames: ["a", "b"] };
  assert.throws(() => assertPackPreserved(a, { ...a, meshes: 1 }), /meshes/);
});

test("index is generated from records, sorted, and flags refusals and ground truth", () => {
  const rec = (id, extra) => ({ path: `objects/${id.slice(0, 2)}/${id}.json`, text: JSON.stringify({ id, source: { name: `${id}.glb`, licence: "CC0" }, ...extra }) });
  const { objects, buckets } = buildIndex([
    rec("85ae91e60ed519f5", { title: "Avocado", status: "refused", parts: null }),
    rec("65bf938f54d6073e", { title: "Duck", ground_truth: true, plan: { parts: [{ name: "body" }, { name: "head" }, { name: "body" }] }, verification: { status: "seeded", reviews: ["a"] } }),
  ]);
  assert.deepEqual(objects.map((o) => o.id), ["65bf938f54d6073e", "85ae91e60ed519f5"]);
  assert.deepEqual(objects[0], {
    id: "65bf938f54d6073e", path: "objects/65/65bf938f54d6073e.json", title: "Duck",
    source: { name: "65bf938f54d6073e.glb", licence: "CC0" }, parts: 3, classes: ["body", "head"],
    status: "seeded", reviews: 1, ground_truth: true,
  });
  assert.equal(objects[1].parts, null);
  assert.deepEqual(buckets, { 65: 1, 85: 1 });
  assert.throws(() => buildIndex([rec("65bf938f54d6073e", {}), { ...rec("65bf938f54d6073e", {}), path: "objects/65/x.json" }]), /duplicate/);
});
