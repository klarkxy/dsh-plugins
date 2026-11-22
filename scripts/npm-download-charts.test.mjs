import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDays,
  chunkRanges,
  escapeXml,
  fetchDailySeries,
  fmtCompact,
  fmtInt,
  hasCompleteSeries,
  niceTicks,
  rangeUrl,
  renderChart,
  rollingAverage,
  stitchSeries,
  trimWindow,
} from "./npm-download-charts.mjs";

test("chunkRanges splits long windows into inclusive ≤ maxDays chunks", () => {
  assert.deepEqual(chunkRanges("2026-11-01", "2026-11-21"), [["2026-11-01", "2026-11-21"]]);
  const chunks = chunkRanges("2026-01-01", "2026-12-31", 365);
  assert.equal(chunks.length, 1);
  const long = chunkRanges("2025-01-01", "2026-12-31", 365);
  assert.equal(long.length, 2);
  assert.equal(long[0][0], "2025-01-01");
  assert.equal(addDays(long[0][1], 1), long[1][0]);
  assert.equal(long.at(-1)[1], "2026-12-31");
  // Chunks cover every day exactly once.
  const covered = long.reduce((sum, [s, e]) => sum + Math.round((Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86400000) + 1, 0);
  assert.equal(covered, 730);
});

test("rangeUrl encodes scoped package names", () => {
  assert.equal(
    rangeUrl("@klarkxy/dsh-model-picker", "2026-11-01", "2026-11-21"),
    "https://api.npmjs.org/downloads/range/2026-11-01:2026-11-21/%40klarkxy%2Fdsh-model-picker",
  );
});

test("stitchSeries merges chunks, de-duplicates and sorts days", () => {
  const series = stitchSeries([
    { downloads: [{ day: "2026-11-02", downloads: 5 }, { day: "2026-11-03", downloads: 7 }] },
    { downloads: [{ day: "2026-11-01", downloads: 3 }, { day: "2026-11-02", downloads: 999 }] },
  ]);
  // Later chunks win on overlap (they carry the fresher data).
  assert.deepEqual(series, [
    { day: "2026-11-01", downloads: 3 },
    { day: "2026-11-02", downloads: 999 },
    { day: "2026-11-03", downloads: 7 },
  ]);
  assert.deepEqual(stitchSeries([{}, { downloads: "nope" }]), []);
});

test("trimWindow drops leading and trailing all-zero days, keeps a floor for empty windows", () => {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
  assert.deepEqual(trimWindow(days, [0, 0, 4, 9, 12, 3, 0, 0]), { start: 2, end: 7 }); // short window: keep the 7-day floor
  const twelve = Array.from({ length: 12 }, (_, i) => addDays("2026-11-01", i));
  assert.deepEqual(trimWindow(twelve, [0, 0, 4, 9, 12, 3, 5, 2, 1, 0, 0, 0]), { start: 2, end: 8 });
  assert.deepEqual(trimWindow(days, [0, 0, 0, 0, 0, 0, 0, 0]), { start: 0, end: 7 }); // shorter than 30 days: keep all
  const long = Array.from({ length: 90 }, (_, i) => addDays("2026-09-01", i));
  const trimmed = trimWindow(long, new Array(90).fill(0));
  assert.equal(trimmed.end - trimmed.start + 1, 30);
  assert.throws(() => trimWindow(days, [1, 2]), /align/);
});

test("rollingAverage smooths with a trailing window", () => {
  assert.deepEqual(rollingAverage([7, 0, 0, 0, 0, 0, 0], 7), [7, 3.5, 7 / 3, 1.75, 1.4, 7 / 6, 1]);
  assert.deepEqual(rollingAverage([], 7), []);
});

test("niceTicks rounds up to the 1/2/2.5/5 ladder", () => {
  assert.deepEqual(niceTicks(0), { step: 1, max: 1, ticks: [0, 1] });
  assert.deepEqual(niceTicks(87), { step: 25, max: 100, ticks: [0, 25, 50, 75, 100] });
  assert.deepEqual(niceTicks(320), { step: 100, max: 400, ticks: [0, 100, 200, 300, 400] });
  assert.deepEqual(niceTicks(9500), { step: 2500, max: 10000, ticks: [0, 2500, 5000, 7500, 10000] });
});

test("fmtCompact and fmtInt render readable numbers", () => {
  assert.equal(fmtCompact(999), "999");
  assert.equal(fmtCompact(1200), "1.2k");
  assert.equal(fmtCompact(7002), "7k");
  assert.equal(fmtCompact(68304), "68.3k");
  assert.equal(fmtCompact(2500000), "2.5M");
  assert.equal(fmtInt(68304), "68,304");
});

test("renderChart emits a self-contained, escaped SVG with both polylines", () => {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
  const svg = renderChart({ title: "@klarkxy/dsh-<x>", subtitle: "4 downloads · test", days, values: [0, 3, 1, 4], color: "#3c63e8" });
  assert.match(svg, /^<svg/);
  assert.match(svg, /prefers-color-scheme: dark/);
  assert.match(svg, /class="daily"/);
  assert.match(svg, /class="smooth"/);
  assert.match(svg, /class="area"/);
  assert.match(svg, /11-01/);
  assert.match(svg, /11-04/);
  assert.match(svg, /@klarkxy\/dsh-&lt;x&gt;/);
  assert.doesNotMatch(svg, /<script/);
  assert.throws(() => renderChart({ title: "x", subtitle: "y", days: [], values: [] }), /non-empty/);
  assert.throws(() => renderChart({ title: "x", subtitle: "y", days, values: [1] }), /aligned/);
});

test("fetchDailySeries stitches chunked windows through the injected fetcher", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const [, start, end] = /range\/(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})/.exec(url);
    return {
      downloads: [
        { day: start, downloads: 1 },
        { day: end, downloads: 2 },
      ],
    };
  };
  const series = await fetchDailySeries("@klarkxy/dsh-x", "2025-01-01", "2026-12-31", fetcher);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes(encodeURIComponent("@klarkxy/dsh-x")));
  assert.deepEqual(series.at(-1), { day: "2026-12-31", downloads: 2 });
});

test("escapeXml neutralizes markup", () => {
  assert.equal(escapeXml(`<img src=x onerror="a('b')&c">`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&amp;c&quot;&gt;");
});

test("aggregate charts require complete data from every plugin", () => {
  const plugins = [{ slug: "one" }, { slug: "two" }];
  assert.equal(hasCompleteSeries(new Map([["one", [1]], ["two", [2]]]), plugins), true);
  assert.equal(hasCompleteSeries(new Map([["one", [1]]]), plugins), false);
});
