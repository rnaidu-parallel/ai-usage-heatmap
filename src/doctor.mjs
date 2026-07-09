import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseCcusageUsage } from './adapters/ccusage.mjs';
import { parseTokscaleUsage } from './adapters/tokscale.mjs';
import { daysBetween, parseDateString } from './date.mjs';

function run(command, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 1024 * 1024 * 200 }, (error, stdout, stderr) => {
      if (error?.code === 'ENOENT') {
        resolve({ found: false, ok: false, stdout: '', stderr: '', error });
        return;
      }
      resolve({ found: true, ok: !error, stdout, stderr, error });
    });
  });
}

async function commandInfo(command) {
  const result = await run(command, ['--version']);
  if (!result.found) return { found: false };
  const version = result.stdout.trim() || result.stderr.trim();
  return { found: true, version: version || undefined };
}

function zeroGapCount(series, dateRange) {
  if (!dateRange?.start || !dateRange?.end) return 0;
  const spanDays = daysBetween(parseDateString(dateRange.start), parseDateString(dateRange.end)) + 1;
  return Math.max(0, spanDays - series.length);
}

async function inspectTokscale() {
  const result = await run('tokscale', ['graph'], 120000);
  if (!result.found) return null;
  if (!result.ok) return { label: 'tokscale graph', error: result.stderr.trim() || result.error?.message || 'failed' };
  const parsed = parseTokscaleUsage(result.stdout, { metric: 'total' });
  return {
    label: 'tokscale graph',
    days: parsed.stats.days,
    dateRange: parsed.stats.dateRange,
    zeroGaps: zeroGapCount(parsed.series, parsed.stats.dateRange)
  };
}

async function inspectCcusage() {
  const result = await run('ccusage', ['daily', '--json'], 120000);
  if (!result.found) return null;
  if (!result.ok) return { label: 'ccusage daily --json', error: result.stderr.trim() || result.error?.message || 'failed' };
  const parsed = parseCcusageUsage(result.stdout, { metric: 'total' });
  return {
    label: 'ccusage daily --json',
    days: parsed.stats.days,
    dateRange: parsed.stats.dateRange,
    zeroGaps: zeroGapCount(parsed.series, parsed.stats.dateRange)
  };
}

export async function readCleanupPeriodDays(claudeDir = join(homedir(), '.claude')) {
  try {
    const raw = await readFile(join(claudeDir, 'settings.json'), 'utf8');
    const settings = JSON.parse(raw);
    return settings?.cleanupPeriodDays;
  } catch {
    return undefined;
  }
}

function formatFound(info) {
  if (!info.found) return 'not found. npx-only installs are not detected; --input <file> works instead.';
  return info.version ? `found (${info.version})` : 'found';
}

function formatDateRange(dateRange) {
  if (!dateRange?.start || !dateRange?.end) return 'none';
  return `${dateRange.start} to ${dateRange.end}`;
}

function sourceLine(inspected) {
  if (!inspected) return null;
  if (inspected.error) return `${inspected.label}: unable to inspect usage (${inspected.error})`;
  return `${inspected.label}: ${inspected.days} days, date range ${formatDateRange(inspected.dateRange)}, zero-day gaps ${inspected.zeroGaps}`;
}

export async function doctorReport() {
  const lines = [];

  try {
    const [tokscale, ccusage] = await Promise.all([commandInfo('tokscale'), commandInfo('ccusage')]);
    lines.push('Display-layer sources:');
    lines.push(`tokscale on PATH: ${formatFound(tokscale)}`);
    lines.push(`ccusage on PATH: ${formatFound(ccusage)}`);

    const inspections = await Promise.all([inspectTokscale(), inspectCcusage()]);
    for (const inspected of inspections) {
      const line = sourceLine(inspected);
      if (line) lines.push(line);
    }
  } catch (error) {
    lines.push(`Display-layer source check failed: ${error.message}`);
  }

  const cleanupPeriodDays = await readCleanupPeriodDays();
  lines.push('');
  lines.push('Claude Code retention:');
  if (typeof cleanupPeriodDays !== 'number' || cleanupPeriodDays < 365) {
    lines.push('WARN: trackers read Claude Code local session logs, and Claude Code deletes them after 30 days by default. Any tracker history for Claude is truncated unless cleanupPeriodDays is raised.');
    lines.push('Fix in ~/.claude/settings.json:');
    lines.push(JSON.stringify({ cleanupPeriodDays: 99999 }, null, 2));
  } else {
    lines.push(`cleanupPeriodDays: ${cleanupPeriodDays}`);
  }

  return lines.join('\n');
}
