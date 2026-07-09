import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTokscaleUsage } from '../src/adapters/tokscale.mjs';
import { levelForValue, renderHeatmap, thresholdsForSeries } from '../src/render.mjs';
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

test('zero-active-days series renders all calendar cells at level0', () => {
  const svg = renderHeatmap([], { today: '2026-07-09', theme: 'light', weeks: 1 });
  const activeCell = svg.match(/data-level="[1-4]"/);

  assert.equal(activeCell, null);
  assert.match(svg, /#ebedf0/);
});

test('renderer does not leak tracker source metadata', async () => {
  const { series } = parseTokscaleUsage(await readFile(tokscaleFixture, 'utf8'), { metric: 'total' });
  const svg = renderHeatmap(series, { today: '2026-07-09', theme: 'dark', weeks: 2 });

  assert.equal(svg.includes('claude'), false);
  assert.equal(svg.includes('tokscale'), false);
  assert.equal(svg.includes('modelId'), false);
  assert.equal(svg.includes('cost'), false);
  assert.equal(svg.includes('synthetic-opus'), false);
});
