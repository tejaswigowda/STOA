import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fetchBytes, packToGlb, parseGlb, sha256 } from "./lib.mjs";

const cacheDir = ".cache/raw";

/** Fetch a file from the pinned Khronos commit; cached by url. */
export async function fetchPinned(source, filePath) {
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
  const key = path.join(cacheDir, sha256(url));
  if (existsSync(key)) return readFile(key);
  const bytes = await fetchBytes(url);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(key, bytes);
  return bytes;
}

/**
 * The canonical .glb of a triaged model. glTF-only models are packed, and the
 * packed hash must equal the one recorded in the triage (packing is deterministic).
 */
export async function loadCanonicalGlb(triage, model) {
  const row = triage.assets.find((a) => a.model === model && a.canonical);
  if (!row) throw new Error(`no canonical asset for model "${model}" in triage`);
  const bytes = await fetchPinned(triage.source, row.path);
  if (sha256(bytes) !== row.sha256) throw new Error(`${row.path}: source hash differs from triage`);
  if (row.format === "glb") return { row, glb: bytes };
  const dir = path.posix.dirname(row.path);
  const { glb } = await packToGlb(JSON.parse(bytes.toString("utf8")), (uri) => fetchPinned(triage.source, `${dir}/${uri}`));
  if (sha256(glb) !== row.source.packed.sha256) throw new Error(`${row.path}: packed hash differs from triage`);
  return { row, glb };
}
