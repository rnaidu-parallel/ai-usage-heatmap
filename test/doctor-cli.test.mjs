import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { doctorReport, readCleanupPeriodDays } from '../src/doctor.mjs';

const execFileAsync = promisify(execFile);
const cli = new URL('../bin/cli.mjs', import.meta.url).pathname;
const tokscale = new URL('./fixtures/tokscale-graph.json', import.meta.url).pathname;
const ccusage = new URL('./fixtures/ccusage-daily.json', import.meta.url).pathname;
const byo = new URL('./fixtures/byo.json', import.meta.url).pathname;

test('doctor reports display-layer sources and retention section', async () => {
  const output = await doctorReport();

  assert.match(output, /Display-layer sources:/);
  assert.match(output, /tokscale on PATH:/);
  assert.match(output, /ccusage on PATH:/);
  assert.match(output, /Claude Code retention:/);
});

test('cleanupPeriodDays reads Claude Code settings best effort', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-heatmap-claude-'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 99999 }));

  assert.equal(await readCleanupPeriodDays(dir), 99999);
  assert.equal(await readCleanupPeriodDays(join(dir, 'missing')), undefined);
});

test('cli render smoke writes both SVGs from tokscale input and prints snippet', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'ai-usage-heatmap-out-'));
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    cli,
    'render',
    '--source',
    'tokscale',
    '--input',
    tokscale,
    '--today',
    '2026-07-09',
    '--out-dir',
    outDir
  ]);

  assert.match(stdout, /<picture>/);
  assert.match(stdout, /ai-usage-dark\.svg/);
  assert.match(stderr, /Source: tokscale graph/);
  assert.match(stderr, /Stats: 3 days, date range 2026-07-01 to 2026-07-07/);
  await access(join(outDir, 'ai-usage-dark.svg'));
  await access(join(outDir, 'ai-usage-light.svg'));

  const dark = await readFile(join(outDir, 'ai-usage-dark.svg'), 'utf8');
  assert.match(dark, /AI token usage heatmap/);
  assert.match(dark, /AI token usage/);
  assert.match(dark, /ALL TIME/);
  assert.match(dark, /<title>claude<\/title>/);
  assert.match(dark, /AI tokens incl\. cache · updated 2026-07-09/);
});

test('cli render supports ccusage input', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'ai-usage-heatmap-out-'));
  const { stderr } = await execFileAsync(process.execPath, [
    cli,
    'render',
    '--source',
    'ccusage',
    '--input',
    ccusage,
    '--today',
    '2026-07-09',
    '--out-dir',
    outDir
  ]);

  assert.match(stderr, /Source: ccusage daily --json/);
  await access(join(outDir, 'ai-usage-dark.svg'));
  await access(join(outDir, 'ai-usage-light.svg'));

  const dark = await readFile(join(outDir, 'ai-usage-dark.svg'), 'utf8');
  assert.match(dark, /AI token usage/);
  assert.match(dark, /ALL TIME/);
  assert.doesNotMatch(dark, /<path d="/);
});

test('cli render supports heatmap-only output', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'ai-usage-heatmap-out-'));
  await execFileAsync(process.execPath, [
    cli,
    'render',
    '--source',
    'tokscale',
    '--input',
    tokscale,
    '--today',
    '2026-07-09',
    '--heatmap-only',
    '--out-dir',
    outDir
  ]);

  const dark = await readFile(join(outDir, 'ai-usage-dark.svg'), 'utf8');
  assert.doesNotMatch(dark, />AI token usage<\/text>/);
  assert.doesNotMatch(dark, /ALL TIME/);
  assert.doesNotMatch(dark, /<title>claude<\/title>/);
});

test('cli render io metric caption states input plus output', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'ai-usage-heatmap-out-'));
  await execFileAsync(process.execPath, [
    cli,
    'render',
    '--source',
    'json',
    '--input',
    byo,
    '--metric',
    'io',
    '--today',
    '2026-07-09',
    '--out-dir',
    outDir
  ]);

  const dark = await readFile(join(outDir, 'ai-usage-dark.svg'), 'utf8');
  assert.match(dark, /AI tokens in\+out · updated 2026-07-09/);
});

test('cli runs when invoked through an npm-style symlink', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-heatmap-symlink-'));
  const link = join(dir, 'ai-usage-heatmap');
  const outDir = join(dir, 'assets');
  await symlink(cli, link);

  const { stdout } = await execFileAsync(process.execPath, [
    link,
    'render',
    '--source',
    'json',
    '--input',
    byo,
    '--today',
    '2026-07-09',
    '--out-dir',
    outDir
  ]);

  assert.match(stdout, /<picture>/);
  assert.match(stdout, /ai-usage-dark\.svg/);
  await access(join(outDir, 'ai-usage-dark.svg'));
  await access(join(outDir, 'ai-usage-light.svg'));
});

test('cli render keeps render validation errors unmasked', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      cli,
      'render',
      '--source',
      'json',
      '--input',
      byo,
      '--today',
      'not-a-date'
    ]),
    (error) => {
      assert.match(error.stderr, /date/i);
      assert.doesNotMatch(error.stderr, /Unable to write SVG output/);
      return true;
    }
  );
});

test('cli render rejects weeks above the cap', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      cli,
      'render',
      '--source',
      'json',
      '--input',
      byo,
      '--weeks',
      '521'
    ]),
    (error) => {
      assert.match(error.stderr, /Invalid --weeks: expected 1-520/);
      return true;
    }
  );
});

test('cli doctor exits zero', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    'doctor'
  ]);

  assert.match(stdout, /Display-layer sources:/);
  assert.match(stdout, /Claude Code retention:/);
});
