// Drive the real Strata editor (headless Chromium) so SEG runs exactly as it does for a person:
// the glTF importer, the Shell's SEG surface, the same modules. Nothing here re-implements SEG.
//
// Needs playwright-core (`npm i --no-save playwright-core`, not a dependency of this repo), a
// Chromium it can launch, and the editor served from a checkout of strata-editor:
//   cd strata-editor && node server.js 5611
// STRATA_URL, CHROMIUM and (for the import) nothing else are read from the environment.

const DEFAULT_CHROMIUM = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  return chromium.launch({
    executablePath: process.env.CHROMIUM ?? DEFAULT_CHROMIUM,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
}

/** A fresh editor page. Pass `browser` to share one Chromium between pages; otherwise one is launched and closed with the page. */
export async function openEditor({ url = process.env.STRATA_URL ?? "http://localhost:5611/", browser } = {}) {
  const own = !browser;
  browser ??= await launchBrowser();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("editor pageerror:", e.message.slice(0, 300)));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.editor, null, { timeout: 60000 });
  return { browser, page, url, close: () => (own ? browser.close() : page.close()) };
}

let routeCount = 0;

/**
 * Import a .glb through the editor's own loader. Returns the meshes in scene order, which for a flattened
 * asset is primitive order: [{ index, name, material, triangles, area }]. Also builds `window.__SEG` from the
 * same modules the Shell uses.
 */
export async function importGlb({ page }, bytes, name = "flattened.glb") {
  const path = `/__glb/${++routeCount}`;
  await page.route(`**${path}`, (r) => r.fulfill({ body: bytes, contentType: "model/gltf-binary" }));
  return page.evaluate(async ({ path, name }) => {
    const buf = await (await fetch(path)).arrayBuffer();
    // the renderer is created asynchronously; the importer needs it
    for (let i = 0; ; i++) {
      try { await editor.loader.loadGLBBytes(buf, name); break; }
      catch (e) { if (!/isWebGPURenderer/.test(e.message) || i > 90) throw e; await new Promise((r) => setTimeout(r, 1000)); }
    }
    const { makeSegment } = await import("/editor/js/intelligence/meshSegment.js");
    const { AddObjectCommand } = await import("/editor/js/commands/AddObjectCommand.js");
    const { RemoveObjectCommand } = await import("/editor/js/commands/RemoveObjectCommand.js");
    const { SetMaterialCommand } = await import("/editor/js/commands/SetMaterialCommand.js");
    const { MultiCmdsCommand } = await import("/editor/js/commands/MultiCmdsCommand.js");
    const { makeQuery } = await import("/editor/js/intelligence/opPrimitive.js");
    const { indexSubtree } = await import("/editor/js/intelligence/descriptors.js");
    window.__SEG = makeSegment(editor, { THREE: window.THREE, commands: { AddObjectCommand, RemoveObjectCommand, SetMaterialCommand, MultiCmdsCommand }, query: makeQuery(editor), index: indexSubtree });
    window.__core = await import("/editor/js/intelligence/meshSegment.js");
    window.__tex = await import("/editor/js/intelligence/textureColour.js");
    window.__meshes = [];
    editor.scene.traverse((o) => { if (o.isMesh) window.__meshes.push(o); });
    const areaOf = (g) => {
      const pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
      const v = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
      let a = 0;
      for (let t = 0; t < n; t += 3) {
        const [p, q, r] = [0, 1, 2].map((k) => v(idx ? idx.getX(t + k) : t + k));
        const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
        a += 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
      }
      return a;
    };
    return window.__meshes.map((o, index) => ({
      index, name: o.name, material: Array.isArray(o.material) ? "(several)" : o.material.name || "",
      triangles: o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3,
      area: areaOf(o.geometry),
    }));
  }, { path, name });
}

/** Islands of a mesh as triangle numbers, in SEG's own order (the numbering a plan's `island` refers to). */
export const islandsOf = ({ page }, mesh) =>
  page.evaluate((i) => window.__core.islandsOf(window.__tex.dataOfGeometry(window.__meshes[i].geometry)), mesh);

/** What a plan author sees: SEG's own report, as text and as data. No answer key, no authored part names. */
export const evidence = ({ page }, mesh, k = 3) =>
  page.evaluate(({ i, k }) => {
    const node = window.__meshes[i];
    return { describe: window.__SEG.describe(node, k), data: window.__SEG.data(node, k) };
  }, { i: mesh, k });

export const wouldRefuse = ({ page }, mesh, plan) =>
  page.evaluate(({ i, plan }) => (window.__SEG.wouldRefuse ? window.__SEG.wouldRefuse(window.__meshes[i], plan ?? undefined) : "unavailable"), { i: mesh, plan });

/** Cut one mesh with SEG.split / SEG.byMaterial and return the record SEG wrote (parents included). */
export const cut = ({ page }, mesh, plan, method = "islands") =>
  page.evaluate(({ i, plan, method }) => {
    const node = window.__meshes[i];
    const text = method === "material" ? window.__SEG.byMaterial(node, plan) : window.__SEG.split(node, plan);
    const group = editor.scene.getObjectByName(plan.group);
    if (!group || !group.userData.segmentation) throw new Error("SEG made no group named " + plan.group);
    return { text, record: JSON.parse(JSON.stringify(group.userData.segmentation)) };
  }, { i: mesh, plan, method });
