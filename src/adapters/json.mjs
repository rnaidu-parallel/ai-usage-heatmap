import { readFile } from 'node:fs/promises';
import { isDateString } from '../date.mjs';

function validateEntry(entry, index, seenDates) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Invalid JSON entry at index ${index}: expected an object`);
  }

  const keys = Object.keys(entry).sort();
  if (keys.length !== 2 || keys[0] !== 'date' || keys[1] !== 'total') {
    throw new Error(`Invalid JSON entry at index ${index}: expected only date and total`);
  }

  if (!isDateString(entry.date)) {
    throw new Error(`Invalid JSON entry at index ${index}: date must be YYYY-MM-DD`);
  }

  if (seenDates.has(entry.date)) {
    throw new Error(`Invalid JSON entry at index ${index}: duplicate date`);
  }
  seenDates.add(entry.date);

  if (
    typeof entry.total !== 'number' ||
    !Number.isFinite(entry.total) ||
    entry.total < 0
  ) {
    throw new Error(`Invalid JSON entry at index ${index}: total must be a non-negative number`);
  }

  return { date: entry.date, total: entry.total };
}

export function parseJsonUsage(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Input JSON must be a valid JSON array');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Input JSON must be an array of {date, total} objects');
  }

  const seenDates = new Set();
  return parsed
    .map((entry, index) => validateEntry(entry, index, seenDates))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function readJsonUsage(input) {
  try {
    return parseJsonUsage(await readFile(input, 'utf8'));
  } catch (error) {
    if (error?.code) {
      throw new Error('Unable to read input JSON file');
    }
    throw error;
  }
}
