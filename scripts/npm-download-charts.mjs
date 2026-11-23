#!/usr/bin/env node
// Generate npm download-trend SVG charts for every plugin in site/catalog.json
// plus one aggregate chart, from the public npm downloads API. The output
// directory mirrors the docs/demo-assets media branch, where a scheduled
// workflow publishes the charts; READMEs reference the raw URLs.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RANGE_API = "https://api.npmjs.org/downloads/range";

export const AGGREGATE_SLUG = "all";
export const WINDOW_DAYS = 90;
/** The npm range endpoint silently caps long responses at ~549 days; stay well below. */
export const MAX_RANGE_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helpers (covered by scripts/npm-download-charts.test.mjs offline)

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function dayOf(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(day, n) {
  return dayOf(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
}

/** Split [startDay, endDay] into inclusive windows of at most maxDays days. */
export function chunkRanges(startDay, endDay, maxDays = MAX_RANGE_DAYS) {
  const chunks = [];
  let cursor = startDay;
  while (cursor <= endDay) {
    const end = addDays(cursor, maxDays - 1) < endDay ? addDays(cursor, maxDays - 1) : endDay;
    chunks.push([cursor, end]);
    cursor = addDays(end, 1);
  }
  return chunks;
}

export function rangeUrl(pkg, startDay, endDay) {
  return `${RANGE_API}/${startDay}:${endDay}/${encodeURIComponent(pkg)}`;
}

/** Merge chunked range responses into one ordered, de-duplicated day series. */
export function stitchSeries(responses) {
  const byDay = new Map();
  for (const response of responses) {
    for (const entry of response.downloads ?? []) {
      if (entry && typeof entry.day === "string" && Number.isFinite(entry.downloads)) byDay.set(entry.day, entry.downloads);
    }
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, downloads]) => ({ day, downloads }));
}

/**
 * Pick the shared chart window: drop leading all-zero days (before the family
 * existed) and trailing all-zero days (today is still being aggregated).
 * An all-zero window keeps its last 30 days so the flat line stays readable.
 */
export function trimWindow(days, totals) {
  if (days.length !== totals.length) throw new Error("days and totals must align");
  let start = 0;
  while (start < days.length && totals[start] === 0) start += 1;
  if (start === days.length) return { start: Math.max(0, days.length - 30), end: days.length - 1 };
  let end = days.length - 1;
  while (end > start && totals[end] === 0 && end - start + 1 > 7) end -= 1;
  return { start, end };
}

export function rollingAverage(values, window = 7) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Round the axis up to a 1 / 2 / 2.5 / 5 × 10^k step ladder. */
export function niceTicks(max, target = 4) {
  if (!Number.isFinite(max) || max <= 0) return { step: 1, max: 1, ticks: [0, 1] };
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
  return { step, max: niceMax, ticks };
}

export function fmtCompact(n) {
  const trim = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ""));
  if (Math.abs(n) < 1e3) return String(Math.round(n));
  if (Math.abs(n) < 1e6) return `${trim(Math.round(n / 100) / 10)}k`;
  if (Math.abs(n) < 1e9) return `${trim(Math.round(n / 1e5) / 10)}M`;
  return `${trim(Math.round(n / 1e8) / 10)}B`;
}

export function fmtInt(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

/**
 * Render a self-contained SVG line chart: faint daily polyline, bold 7-day
 * rolling average with a soft area fill, nice y ticks and a few date labels.
 * Colors live on classes so a prefers-color-scheme block can flip them.
 */
export function renderChart({ title, subtitle, days, values, color = "#3c63e8", width = 720, height = 240 }) {
  if (!days.length || days.length !== values.length) throw new Error("days and values must be non-empty and aligned");
  const padL = 48;
  const padR = 16;
  const padT = 42;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const { max } = niceTicks(Math.max(...values, 0));
  const x = (i) => padL + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
  const y = (v) => padT + plotH - (v / max) * plotH;

  const smooth = rollingAverage(values, 7);
  const dailyPoints = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const smoothPoints = smooth.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPath = `M${x(0).toFixed(1)},${y(0).toFixed(1)} ${smooth
    .map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ")} L${x(days.length - 1).toFixed(1)},${y(0).toFixed(1)} Z`;

  const { ticks } = niceTicks(Math.max(...values, 0));
  const grid = ticks
    .map(
      (t) => `<line x1="${padL}" y1="${y(t).toFixed(1)}" x2="${width - padR}" y2="${y(t).toFixed(1)}" class="grid"/>`
        + `<text x="${padL - 8}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" class="tick">${escapeXml(fmtCompact(t))}</text>`,
    )
    .join("\n  ");
  const xLabelIndexes = [...new Set([0, Math.floor((days.length - 1) / 3), Math.floor((2 * (days.length - 1)) / 3), days.length - 1])];
  const xLabels = xLabelIndexes
    .map((i) => {
      const anchor = i === 0 ? "start" : i === days.length - 1 ? "end" : "middle";
      return `<text x="${x(i).toFixed(1)}" y="${height - 10}" text-anchor="${anchor}" class="tick">${escapeXml(days[i].slice(5))}</text>`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)} — ${escapeXml(subtitle)}">
<title>${escapeXml(title)} — ${escapeXml(subtitle)}</title>
<style>
  .bg { fill: #ffffff; }
  .title { fill: #0f1115; font: 600 14px ${FONT}; }
  .sub { fill: #61666b; font: 12px ${FONT}; }
  .tick { fill: #81858c; font: 11px ${FONT}; }
  .grid { stroke: #00000014; stroke-width: 1; }
  .axis { stroke: #00000029; stroke-width: 1; }
  .daily { stroke: ${color}; stroke-width: 1.2; fill: none; opacity: 0.28; }
  .smooth { stroke: ${color}; stroke-width: 2.5; fill: none; stroke-linejoin: round; stroke-linecap: round; }
  .area { fill: ${color}; opacity: 0.08; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #151517; }
    .title { fill: #f9fafb; }
    .sub { fill: #cfd3d6; }
    .tick { fill: #adb2b8; }
    .grid { stroke: #ffffff1a; }
    .axis { stroke: #ffffff2e; }
  }
</style>
<rect class="bg" width="${width}" height="${height}" rx="12"/>
<text x="${padL}" y="24" class="title">${escapeXml(title)}</text>
<text x="${width - padR}" y="24" text-anchor="end" class="sub">${escapeXml(subtitle)}</text>
<line x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" class="axis"/>
  ${grid}
  ${xLabels}
<path d="${areaPath}" class="area"/>
<polyline points="${dailyPoints}" class="daily"/>
<polyline points="${smoothPoints}" class="smooth"/>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Live data

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "dsh-plugins-download-charts/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * 3 ** attempt));
    }
  }
  throw lastError;
}

export async function fetchDailySeries(pkg, startDay, endDay, fetcher = fetchJson) {
  const chunks = chunkRanges(startDay, endDay);
  const responses = [];
  for (const [start, end] of chunks) responses.push(await fetcher(rangeUrl(pkg, start, end)));
  return stitchSeries(responses);
}

function parseArgs(argv) {
  const args = { out: "_charts", days: WINDOW_DAYS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--days") args.days = Number(argv[++i]);
    else if (argv[i] === "--catalog") args.catalog = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(args.days) || args.days < 7) throw new Error("--days must be an integer >= 7");
  return args;
}

export function valuesForDays(series, days) {
  const byDay = new Map(series.map(entry => [entry.day, entry.downloads]));
  const values = days.map(day => byDay.get(day));
  return values.every(value => Number.isFinite(value)) ? values : undefined;
}

export function hasCompleteSeries(perPlugin, plugins) {
  return plugins.every(plugin => perPlugin.has(plugin.slug));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = JSON.parse(await readFile(args.catalog ?? path.join(REPO_ROOT, "site", "catalog.json"), "utf8"));
  const outDir = path.resolve(REPO_ROOT, args.out);
  await mkdir(outDir, { recursive: true });

  const endDay = dayOf(new Date());
  const startDay = addDays(endDay, -(args.days - 1));
  const days = Array.from({ length: args.days }, (_, i) => addDays(startDay, i));

  const perPlugin = new Map();
  const failures = [];
  for (const plugin of catalog.plugins) {
    try {
      const series = await fetchDailySeries(plugin.package, startDay, endDay);
      const values = valuesForDays(series, days);
      if (values === undefined) throw new Error("the npm response is missing one or more dates");
      perPlugin.set(plugin.slug, values);
      console.log(`${plugin.package}: ${fmtInt(series.reduce((sum, entry) => sum + entry.downloads, 0))} downloads in window`);
    } catch (error) {
      failures.push(plugin.package);
      console.warn(`warning: ${plugin.package}: ${error.message} (keeping any previous chart)`);
    }
  }
  if (failures.length > catalog.plugins.length / 2) {
    throw new Error(`npm downloads API looks down: ${failures.length}/${catalog.plugins.length} packages failed`);
  }

  const totals = days.map((_, i) => [...perPlugin.values()].reduce((sum, values) => sum + values[i], 0));
  const { start, end } = trimWindow(days, totals);
  const windowDays = days.slice(start, end + 1);
  const windowTotals = totals.slice(start, end + 1);
  const rangeLabel = `${windowDays[0]} → ${windowDays[windowDays.length - 1]}`;

  const written = [];
  for (const plugin of catalog.plugins) {
    const values = perPlugin.get(plugin.slug);
    if (!values) continue;
    const windowValues = values.slice(start, end + 1);
    const svg = renderChart({
      title: plugin.package,
      subtitle: `${fmtInt(windowValues.reduce((a, b) => a + b, 0))} downloads · ${rangeLabel}`,
      days: windowDays,
      values: windowValues,
      color: "#3c63e8",
    });
    const file = path.join(outDir, `downloads-${plugin.slug}.svg`);
    await writeFile(file, svg);
    written.push(file);
  }

  if (hasCompleteSeries(perPlugin, catalog.plugins)) {
    const aggregateSvg = renderChart({
      title: "klarkxy DSH plugins — npm downloads",
      subtitle: `${fmtInt(windowTotals.reduce((a, b) => a + b, 0))} downloads · ${rangeLabel}`,
      days: windowDays,
      values: windowTotals,
      color: "#657bd6",
    });
    const aggregateFile = path.join(outDir, `downloads-${AGGREGATE_SLUG}.svg`);
    await writeFile(aggregateFile, aggregateSvg);
    written.push(aggregateFile);
  } else {
    console.warn(`warning: keeping the previous aggregate chart because ${failures.length} package(s) have incomplete data`);
  }

  console.log(`wrote ${written.length} charts to ${path.relative(REPO_ROOT, outDir)} (${rangeLabel})`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
