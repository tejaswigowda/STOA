import test from "node:test";
import assert from "node:assert/strict";
import { buildSite, loadSiteData, SITE } from "./page.mjs";

const data = loadSiteData(".");
const site = buildSite(data);
const index = site["docs/index.html"];
const rowsOf = (html, id) => [...html.matchAll(new RegExp(`<table id="${id}">[\\s\\S]*?</table>`, "g"))][0][0].match(/<tr data-tier[\s\S]*?<\/tr>/g);

test("W2: the page is complete in the HTML: every model has a row in the structure table, Tier A in the naming table", () => {
  const models = new Set(data.rows.map((r) => r.model));
  assert.equal(rowsOf(index, "structure").length, models.size);
  assert.equal(rowsOf(index, "naming").length, new Set(data.rows.filter((r) => r.tier === "A").map((r) => r.model)).size);
  for (const m of models) assert.ok(site[`docs/models/${m}.html`], `a page for ${m}`);
  assert.match(index, /macro mean best IoU is <b>0\.\d{3}<\/b>/);
});

test("W3: precision and coverage lead, and 'same' never stands alone as a rate", () => {
  assert.ok(index.indexOf("is right") < index.indexOf("macro mean best IoU"));
  const text = index.replace(/<[^>]+>/g, " ");
  assert.ok(!/\d%\s+same(?!-or)/.test(text) && !/same rate/i.test(text));
  assert.match(text, /judge A ruled \d+ pairs same, judge B \d+/);
});

test("W4: abstained exists in the data, the rubric and the page", () => {
  assert.ok(data.rows.some((r) => r.verdict === "abstained"));
  assert.ok(data.rows.filter((r) => r.verdict === "abstained").every((r) => r.judge_verdict === "wrong" && r.recovered_label === "descriptive"));
  assert.match(index, /<th>abstained<\/th>/);
});

test("W5: the leak confound is in the same sentence as the precision figure", () => {
  const headline = index.match(/<p class="headline"><b>([\s\S]*?)<\/b>/)[1];
  assert.match(headline, /is right \d+% of the time/);
  assert.match(headline, /may be inflated because [\d.]+% of Tier A authored part names share a word with their material/);
});

test("W6 and W7: the ceiling banner is above the first number and the failure set has its own heading", () => {
  const banner = index.indexOf('id="ceiling"');
  assert.ok(banner > 0 && banner < index.indexOf('id="trace"') && banner < index.indexOf('id="headline"'));
  assert.ok(!/\d/.test(index.slice(index.indexOf("<body>"), banner).replace(/<[^>]+>/g, "")));
  assert.match(index, /<h2 id="failures">The failure set<\/h2>/);
  assert.ok(index.indexOf('id="trace"') < index.indexOf('id="material"'), "traceability near the top");
});

test("W8: Open Graph and Twitter tags with an absolute image that is a real PNG", () => {
  for (const tag of ["og:title", "og:description", "og:image", "og:url"]) assert.match(index, new RegExp(`property="${tag}" content="[^"]+"`));
  assert.match(index, /name="twitter:card" content="summary_large_image"/);
  assert.match(index, new RegExp(`property="og:image" content="${SITE}og\\.png"`));
  assert.deepEqual([...site["docs/og.png"].subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(site["docs/robots.txt"], /Sitemap: https:\/\/.+\/sitemap\.xml/);
  assert.match(site["docs/sitemap.xml"], new RegExp(`<loc>${SITE}</loc>`));
});

test("W9: every table row links to its plan, its rows and its source at the pinned commit", () => {
  for (const id of ["structure", "naming"]) {
    for (const row of rowsOf(index, id)) {
      assert.match(row, /results\/plans\/materials\/[^"]+\.json">plan</);
      assert.match(row, /models\/[^"]+\.html">rows</);
      assert.match(row, new RegExp(`raw\\.githubusercontent\\.com/${data.triage.source.repo}/${data.triage.source.commit}/[^"]+">source<`));
    }
  }
});

test("W1: the site is a pure function of the data: building it twice gives the same bytes", () => {
  const again = buildSite(data);
  for (const [f, content] of Object.entries(site)) assert.ok(Buffer.from(content).equals(Buffer.from(again[f])), f);
});
