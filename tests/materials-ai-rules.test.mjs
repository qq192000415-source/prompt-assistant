// 管理员下发的 AI 功能规则：修改、隐藏、新增、恢复默认后，规则列表和发给模型的要求是否正确。
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuleInstructions, normalizeRuleOverrides, resolveRules, selectedRuleIds } from '../electron/materials/aiRules.ts';
import { aiFeatureActionMeta } from '../electron/materials/suyan/aiTypes.ts';

const meta = aiFeatureActionMeta['image-reverse'];
const [first, second] = meta.rulePresets;

test('没有改动时就是素言的内置规则，默认选内置默认规则', () => {
  const rules = resolveRules('image-reverse', {});
  assert.deepEqual(rules.map((rule) => rule.id), meta.rulePresets.map((preset) => preset.id));
  assert.ok(rules.every((rule) => rule.builtin && !rule.modified && !rule.hidden));
  assert.deepEqual(selectedRuleIds('image-reverse', rules, undefined), [meta.defaultRulePreset.id]);
});

test('改内置规则、隐藏、新增：列表和拼出的要求都按改动来', () => {
  const overrides = normalizeRuleOverrides({
    'image-reverse': [
      { id: first.id, label: '人像（管理员版）', instructions: '只写人物' },
      { id: second.id, label: second.label, instructions: second.instructions, hidden: true },
      { id: 'custom-abc', label: '电商主图', instructions: '写清卖点' },
      { id: 'bad', label: '', instructions: '没名字的丢掉' },
    ],
    'not-an-action': [{ id: 'x', label: 'x', instructions: 'x' }],
  });
  assert.deepEqual(Object.keys(overrides), ['image-reverse']);
  const rules = resolveRules('image-reverse', overrides);
  const byId = Object.fromEntries(rules.map((rule) => [rule.id, rule]));
  assert.equal(byId[first.id].label, '人像（管理员版）');
  assert.equal(byId[first.id].modified, true);
  // 只隐藏、内容没改的不算修改
  assert.equal(byId[second.id].hidden, true);
  assert.equal(byId[second.id].modified, false);
  assert.equal(rules.at(-1).id, 'custom-abc');
  assert.equal(rules.at(-1).builtin, false);
  assert.equal(byId.bad, undefined);

  // 隐藏的规则就算之前勾过也不用；新增的规则能选
  const chosen = selectedRuleIds('image-reverse', rules, [first.id, second.id, 'custom-abc', 'gone']);
  assert.deepEqual(chosen, [first.id, 'custom-abc']);
  assert.equal(buildRuleInstructions(rules, chosen, '补充一句'), '【人像（管理员版）】\n只写人物\n\n【电商主图】\n写清卖点\n\n补充一句');
});

test('默认规则被隐藏时，没选过的用户用第一条还能用的规则', () => {
  const overrides = normalizeRuleOverrides({ 'image-reverse': [{ id: meta.defaultRulePreset.id, label: 'x', instructions: 'x', hidden: true }] });
  const rules = resolveRules('image-reverse', overrides);
  const chosen = selectedRuleIds('image-reverse', rules, undefined);
  assert.equal(chosen.length, 1);
  assert.notEqual(chosen[0], meta.defaultRulePreset.id);
});

test('提示词优化的默认规则被管理员改过后不会被换回素言原文', () => {
  const optimization = aiFeatureActionMeta['prompt-optimization'].defaultRulePreset;
  const rules = resolveRules('prompt-optimization', normalizeRuleOverrides({ 'prompt-optimization': [{ id: optimization.id, label: '优化', instructions: '管理员写的优化要求' }] }));
  assert.equal(buildRuleInstructions(rules, [optimization.id]), '【优化】\n管理员写的优化要求');
});
