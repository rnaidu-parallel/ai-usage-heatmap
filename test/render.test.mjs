import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTokscaleUsage } from '../src/adapters/tokscale.mjs';
import {
  formatCompact,
  levelForValue,
  renderHeatmap,
  thresholdsForSeries,
  windowStatsForSeries
} from '../src/render.mjs';
import { parseDateString, sundayOnOrBefore, addDays } from '../src/date.mjs';

const tokscaleFixture = new URL('./fixtures/tokscale-graph.json', import.meta.url).pathname;

test('renderer is deterministic with a fixed today', () => {
  const series = [
    { date: '2026-07-01', total: 10 },
    { date: '2026-07-02', total: 20 }
  ];
  const a = renderHeatmap(series, { today: '2026-07-09', theme: 'dark', weeks: 2 });
  const b = renderHeatmap(series, { today: '2026-07-09', theme: 'dark', weeks: 2 });

  assert.equal(a, b);
  assert.match(a, /<title id="title">AI token usage heatmap<\/title>/);
  assert.match(a, /AI tokens · updated 2026-07-09/);
});

test('renderer escapes both quote kinds in captions', () => {
  const svg = renderHeatmap([], {
    today: '2026-07-09',
    theme: 'dark',
    weeks: 1,
    caption: 'AI "quoted" and \'single\''
  });

  assert.match(svg, /AI &quot;quoted&quot; and &#39;single&#39;/);
  assert.doesNotMatch(svg, /AI "quoted" and 'single'/);
});

test('renderer computes quintile levels for a known series', () => {
  const today = parseDateString('2026-07-09');
  const start = sundayOnOrBefore(addDays(today, -(2 * 7) + 1));
  const series = [1, 2, 3, 4, 5].map((total, index) => ({
    date: `2026-07-0${index + 1}`,
    total
  }));
  const thresholds = thresholdsForSeries(series, start, today);

  assert.deepEqual(thresholds, [1, 2, 3, 4]);
  assert.deepEqual([1, 2, 3, 4, 5].map((value) => levelForValue(value, thresholds)), [1, 2, 3, 4, 4]);
});

test('compact formatter trims scaled values', () => {
  assert.deepEqual(
    [999, 1000, 61_234, 258_000_000, 3_341_000_000].map(formatCompact),
    ['999', '1K', '61.2K', '258M', '3.3B']
  );
});

test('window stats use the full series and date-string windows', () => {
  const series = [
    { date: '2026-06-01', total: 100 },
    { date: '2026-06-09', total: 200 },
    { date: '2026-07-02', total: 300 },
    { date: '2026-07-09', total: 400 },
    { date: '2026-07-10', total: 500 }
  ];

  assert.deepEqual(windowStatsForSeries(series, '2026-07-09'), {
    allTime: 1500,
    last30: 700,
    last7: 400,
    today: 400,
    activeDays: 5
  });
});

test('zero-active-days series renders all calendar cells at level0', () => {
  const svg = renderHeatmap([], { today: '2026-07-09', theme: 'light', weeks: 1 });
  const activeCell = svg.match(/data-level="[1-4]"/);

  assert.equal(activeCell, null);
  assert.match(svg, /#ebedf0/);
});

test('renderer adds stat tiles and agent icons when stats and clients are provided', async () => {
  const { series, stats } = parseTokscaleUsage(await readFile(tokscaleFixture, 'utf8'), { metric: 'total' });
  const svg = renderHeatmap(series, {
    today: '2026-07-09',
    theme: 'dark',
    weeks: 2,
    stats: windowStatsForSeries(series, '2026-07-09'),
    clients: stats.clients
  });

  assert.match(svg, /AI token usage/);
  for (const label of ['ALL TIME', 'LAST 30 DAYS', 'LAST 7 DAYS', 'TODAY', 'ACTIVE DAYS']) {
    assert.match(svg, new RegExp(label));
  }
  assert.equal(svg.match(/<path d="/g)?.length, 3);
  assert.match(svg, /<title>claude<\/title>/);
  assert.match(svg, /<title>codex<\/title>/);
  assert.match(svg, /<title>cursor<\/title>/);
  assert.match(svg, /<title>qwen<\/title>/);
  assert.match(svg, /<circle[^>]+fill-opacity="0\.25"/);
  assert.match(svg, />Q<\/text>/);
});

test('renderer can keep exact heatmap-only geometry', async () => {
  const { series, stats } = parseTokscaleUsage(await readFile(tokscaleFixture, 'utf8'), { metric: 'total' });
  const base = renderHeatmap(series, { today: '2026-07-09', theme: 'dark', weeks: 2 });
  const heatmapOnly = renderHeatmap(series, {
    today: '2026-07-09',
    theme: 'dark',
    weeks: 2,
    stats: windowStatsForSeries(series, '2026-07-09'),
    clients: stats.clients,
    header: false
  });

  assert.equal(heatmapOnly, base);
  assert.doesNotMatch(heatmapOnly, />AI token usage<\/text>/);
  assert.doesNotMatch(heatmapOnly, /ALL TIME/);
  assert.doesNotMatch(heatmapOnly, /<title>claude<\/title>/);
});

test('renderer shows title and tiles without an agent row when clients are absent', () => {
  const series = [{ date: '2026-07-09', total: 940 }];
  const svg = renderHeatmap(series, {
    today: '2026-07-09',
    theme: 'light',
    weeks: 1,
    stats: windowStatsForSeries(series, '2026-07-09')
  });

  assert.match(svg, /AI token usage/);
  assert.match(svg, /ALL TIME/);
  assert.doesNotMatch(svg, /<path d="/);
  assert.doesNotMatch(svg, /<circle/);
});

test('renderer does not leak tracker source metadata', async () => {
  const { series, stats } = parseTokscaleUsage(await readFile(tokscaleFixture, 'utf8'), { metric: 'total' });
  const svg = renderHeatmap(series, {
    today: '2026-07-09',
    theme: 'dark',
    weeks: 2,
    stats: windowStatsForSeries(series, '2026-07-09'),
    clients: stats.clients
  });

  assert.equal(svg.includes('claude'), true);
  assert.equal(svg.includes('qwen'), true);
  assert.equal(svg.includes('tokscale'), false);
  assert.equal(svg.includes('modelId'), false);
  assert.equal(svg.includes('providerId'), false);
  assert.equal(svg.includes('cost'), false);
  assert.equal(svg.includes('messages'), false);
  assert.equal(svg.includes('synthetic-opus'), false);
  assert.equal(svg.includes('/Users/'), false);
  assert.equal(svg.includes('\\Users\\'), false);
});
