import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import { CODEX_PREDEFINED_MODELS } from '@/modules/providers/list/codex/codex-models.provider.js';

const require = createRequire(import.meta.url);

const findCodexModel = (value: string) =>
  CODEX_PREDEFINED_MODELS.OPTIONS.find((option) => option.value === value);

test('ships the current GPT-6.2 models and GPT-6.1 Sol with Codex reasoning efforts', () => {
  for (const [value, label] of [
    ['gpt-6.2-astra', 'GPT-6.2 Astra'],
    ['gpt-6.2-sol', 'GPT-6.2 Sol'],
    ['gpt-6.1-sol', 'GPT-6.1 Sol'],
  ]) {
    const model = findCodexModel(value);
    assert.equal(model?.label, label);
    assert.equal(model?.effort?.default, 'low');
    assert.deepEqual(
      model?.effort?.values.map((effort) => effort.value),
      ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    );
    assert.equal(CODEX_PREDEFINED_MODELS.OPTIONS.filter((option) => option.value === value).length, 1);
  }
  assert.deepEqual(
    CODEX_PREDEFINED_MODELS.OPTIONS.slice(0, 4).map((option) => option.value),
    ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6.1-sol'],
  );
  assert.equal(findCodexModel('gpt-6-astra')?.effort?.default, 'medium');
});

test('lists GPT-6 Sol and GPT-6 Luna with the effort levels the Codex CLI accepts', () => {
  const sol = findCodexModel('gpt-6-sol');
  assert.equal(sol?.label, 'GPT-6 Sol');
  assert.equal(sol?.effort?.default, 'medium');
  assert.deepEqual(
    sol?.effort?.values.map((effort) => effort.value),
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  );

  const luna = findCodexModel('gpt-6-luna');
  assert.equal(luna?.label, 'GPT-6 Luna');
  assert.equal(luna?.effort?.default, 'medium');
  assert.deepEqual(
    luna?.effort?.values.map((effort) => effort.value),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  );
});

test('lists GPT-6.1 Terra with the effort choices returned by Codex model/list', () => {
  const terra = findCodexModel('gpt-6.1-terra');
  assert.equal(terra?.label, 'GPT-6.1 Terra');
  assert.equal(terra?.effort?.default, 'low');
  assert.deepEqual(terra?.effort?.values.map(effort => effort.value), ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(CODEX_PREDEFINED_MODELS.OPTIONS.filter(option => option.value === 'gpt-6.1-terra').length, 1);
});

test('bundles the Codex CLI and SDK versions validated with GPT-6.1 Terra', () => {
  const { version } = require('@openai/codex/package.json') as { version: string };
  const [major, minor] = version.split('.').map(Number);
  assert.ok(major > 0 || minor >= 164, `bundled @openai/codex ${version} predates the validated 0.164.0 release`);
  const sdk = JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('@openai/codex-sdk')), 'utf8')) as { version: string };
  assert.equal(sdk.version, version);
});
