import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCcusageUsage } from '../src/adapters/ccusage.mjs';
import { parseJsonUsage } from '../src/adapters/json.mjs';
import { parseTokscaleUsage } from '../src/adapters/tokscale.mjs';
import { resolveUsageSource, sniffSource } from '../src/sources.mjs';

const tokscaleFixture = new URL('./fixtures/tokscale-graph.json', import.meta.url).pathname;
const ccusageFixture = new URL('./fixtures/ccusage-daily.json', import.meta.url).pathname;
const byoFixture = new URL('./fixtures/byo.json', import.meta.url).pathname;

test('tokscale adapter parses total metric and skips zero-total days', async () => {
  const result = parseTokscaleUsage(await readFile(tokscaleFixture, 'utf8'), { metric: 'total' });

  assert.deepEqual(result.series, [
    { date: '2026-07-01', total: 1000 },
    { date: '2026-07-03', total: 2500 },
    { date: '2026-07-07', total: 5000 }
  ]);
  assert.deepEqual(result.stats, {
    days: 3,
    dateRange: { start: '2026-07-01', end: '2026-07-07' },
    generatedAt: '2026-07-09T12:00:00.000Z',
    clients: [
      { name: 'claude', total: 4000 },
      { name: 'cursor', total: 2000 },
      { name: 'codex', total: 1500 },
      { name: 'qwen', total: 1000 }
    ]
  });
});

test('tokscale adapter supports io metric', async () => {
  const result = parseTokscaleUsage(await readFile(tokscaleFixture, 'utf8'), { metric: 'io' });

  assert.deepEqual(result.series, [
    { date: '2026-07-01', total: 300 },
    { date: '2026-07-03', total: 800 },
    { date: '2026-07-07', total: 1200 }
  ]);
  assert.deepEqual(result.stats.clients, [
    { name: 'claude', total: 1000 },
    { name: 'codex', total: 500 },
    { name: 'cursor', total: 500 },
    { name: 'qwen', total: 300 }
  ]);
});

test('tokscale adapter skips malformed client rows without relaxing daily validation', () => {
  const result = parseTokscaleUsage(JSON.stringify({
    contributions: [
      {
        date: '2026-07-01',
        totals: { tokens: 10 },
        tokenBreakdown: { input: 1, output: 2 },
        clients: [
          { client: 'claude', tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 0 } },
          { client: 'broken', tokens: { input: 1, output: -1, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
          { client: 'also-broken' }
        ]
      }
    ]
  }), { metric: 'total' });

  assert.deepEqual(result.stats.clients, [{ name: 'claude', total: 10 }]);
  assert.throws(
    () => parseTokscaleUsage('{"contributions":[{"date":"2026-07-01","totals":{"tokens":1},"tokenBreakdown":{"input":-1,"output":0}}]}', { metric: 'io' }),
    /non-negative/
  );
});

test('tokscale adapter rejects bad shapes and duplicate dates', () => {
  assert.throws(() => parseTokscaleUsage('[]'), /contributions array/);
  assert.throws(() => parseTokscaleUsage('{"contributions":[{"date":"2026-02-30","totals":{"tokens":1}}]}'), /date/);
  assert.throws(() => parseTokscaleUsage('{"contributions":[{"date":"2026-07-01","totals":{"tokens":-1}}]}'), /non-negative/);
  assert.throws(
    () => parseTokscaleUsage('{"contributions":[{"date":"2026-07-01","totals":{"tokens":1}},{"date":"2026-07-01","totals":{"tokens":2}}]}'),
    /duplicate/
  );
});

test('ccusage adapter aggregates duplicate periods and skips zero-total days', async () => {
  const result = parseCcusageUsage(await readFile(ccusageFixture, 'utf8'), { metric: 'total' });

  assert.deepEqual(result.series, [
    { date: '2026-07-01', total: 1000 },
    { date: '2026-07-03', total: 2500 },
    { date: '2026-07-07', total: 5000 }
  ]);
  assert.deepEqual(result.stats, {
    days: 3,
    dateRange: { start: '2026-07-01', end: '2026-07-07' }
  });
});

test('ccusage adapter supports io metric', async () => {
  const result = parseCcusageUsage(await readFile(ccusageFixture, 'utf8'), { metric: 'io' });

  assert.deepEqual(result.series, [
    { date: '2026-07-01', total: 150 },
    { date: '2026-07-03', total: 400 },
    { date: '2026-07-07', total: 1200 }
  ]);
});

test('ccusage adapter rejects bad shapes', () => {
  assert.throws(() => parseCcusageUsage('[]'), /daily array/);
  assert.throws(() => parseCcusageUsage('{"daily":[{"period":"2026-02-30","inputTokens":1,"outputTokens":1,"cacheCreationTokens":1,"cacheReadTokens":1}]}'), /period/);
  assert.throws(() => parseCcusageUsage('{"daily":[{"period":"2026-07-01","inputTokens":1,"outputTokens":1,"cacheCreationTokens":1,"cacheReadTokens":-1}]}'), /non-negative/);
});

test('json adapter validates and sorts the BYO contract', () => {
  assert.deepEqual(parseJsonUsage('[{"date":"2026-07-02","total":2},{"date":"2026-07-01","total":1}]'), [
    { date: '2026-07-01', total: 1 },
    { date: '2026-07-02', total: 2 }
  ]);
});

test('json adapter rejects bad shapes', () => {
  assert.throws(() => parseJsonUsage('{"date":"2026-07-01","total":1}'), /array/);
  assert.throws(() => parseJsonUsage('[{"date":"2026-02-30","total":1}]'), /date/);
  assert.throws(() => parseJsonUsage('[{"date":"2026-07-01","total":-1}]'), /non-negative/);
  assert.throws(() => parseJsonUsage('[{"date":"2026-07-01","total":"1"}]'), /non-negative/);
  assert.throws(() => parseJsonUsage('[{"date":"2026-07-01","total":1,"model":"synthetic"}]'), /only date and total/);
});

test('json adapter rejects duplicate dates', () => {
  assert.throws(() => parseJsonUsage('[{"date":"2026-07-01","total":1},{"date":"2026-07-01","total":2}]'), /duplicate/);
});

test('source sniffing routes fixture files to the right adapter', async () => {
  assert.equal(sniffSource(await readFile(tokscaleFixture, 'utf8')), 'tokscale');
  assert.equal(sniffSource(await readFile(ccusageFixture, 'utf8')), 'ccusage');
  assert.equal(sniffSource(await readFile(byoFixture, 'utf8')), 'json');

  const tokscale = await resolveUsageSource({ source: 'auto', input: tokscaleFixture, metric: 'total' });
  const ccusage = await resolveUsageSource({ source: 'auto', input: ccusageFixture, metric: 'total' });
  const json = await resolveUsageSource({ source: 'auto', input: byoFixture, metric: 'total' });

  assert.equal(tokscale.source, 'tokscale');
  assert.equal(ccusage.source, 'ccusage');
  assert.equal(json.source, 'json');
});

test('source sniffing errors cleanly for garbage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-heatmap-source-'));
  try {
    const input = join(dir, 'garbage.json');
    await writeFile(input, '{"notDaily":[]}');
    await assert.rejects(
      resolveUsageSource({ source: 'auto', input, metric: 'total' }),
      /tokscale graph, ccusage daily, or BYO JSON/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('source resolution can use an injected runner for local tools', async () => {
  const ccusageRaw = await readFile(ccusageFixture, 'utf8');
  const calls = [];
  const result = await resolveUsageSource(
    { source: 'auto', metric: 'total' },
    async (command, args) => {
      calls.push([command, args]);
      if (command === 'tokscale') {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return { stdout: ccusageRaw, stderr: '' };
    }
  );

  assert.deepEqual(calls, [
    ['tokscale', ['graph']],
    ['ccusage', ['daily', '--json']]
  ]);
  assert.equal(result.source, 'ccusage');
  assert.equal(result.stats.days, 3);
});

test('source resolution warns for runnable failures but not missing tools', async () => {
  const ccusageRaw = await readFile(ccusageFixture, 'utf8');
  const warnings = [];
  const originalError = console.error;
  console.error = (message) => warnings.push(message);

  try {
    await resolveUsageSource(
      { source: 'auto', metric: 'total' },
      async (command) => {
        if (command === 'tokscale') {
          const error = new Error('missing');
          error.code = 'ENOENT';
          throw error;
        }
        return { stdout: ccusageRaw, stderr: '' };
      }
    );
    assert.deepEqual(warnings, []);

    await resolveUsageSource(
      { source: 'auto', metric: 'total' },
      async (command) => {
        if (command === 'tokscale') {
          const error = new Error('failed');
          error.code = 1;
          error.stderr = 'first failure line\nsecond failure line\n';
          throw error;
        }
        return { stdout: ccusageRaw, stderr: '' };
      }
    );

    assert.deepEqual(warnings, ['Warning: tokscale failed: first failure line']);
  } finally {
    console.error = originalError;
  }
});
