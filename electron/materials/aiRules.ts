// AI 功能规则的管理员改动（1.17.0）：管理员在 Supabase 表 ai_rule_overrides 里按功能存一份改动，所有登录的账号都按它用规则。
// 改动是一组条目：id 和 SuYan 内置规则相同的是对内置规则的修改（可只改隐藏），其余是管理员新增的规则。删掉内置规则的那条就是「恢复默认」。
// 纯逻辑，Node 测试直接加载；主进程在 aiSettings.ts 里用，界面拿到的是 resolveRules 的结果。
import { AI_COMBINED_INSTRUCTIONS_MAX_LENGTH, AI_RULE_INSTRUCTIONS_MAX_LENGTH, aiFeatureActionMeta, aiFeatureActions, type AiFeatureAction } from './suyan/aiTypes.ts';

export type RuleEntry = { id: string; label: string; instructions: string; hidden?: boolean };
export type RuleOverrides = Partial<Record<AiFeatureAction, RuleEntry[]>>;
export type ResolvedRule = { id: string; label: string; instructions: string; builtin: boolean; modified: boolean; hidden: boolean };

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function normalizeRuleEntries(raw: unknown): RuleEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: RuleEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = text(record.id, 80).replace(/[^a-zA-Z0-9_-]/g, '');
    const label = text(record.label, 80);
    const instructions = text(record.instructions, AI_RULE_INSTRUCTIONS_MAX_LENGTH);
    if (!id || seen.has(id) || !label || !instructions) continue;
    seen.add(id);
    entries.push(record.hidden === true ? { id, label, instructions, hidden: true } : { id, label, instructions });
  }
  return entries.slice(0, 80);
}

export function normalizeRuleOverrides(raw: unknown): RuleOverrides {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const overrides: RuleOverrides = {};
  for (const action of aiFeatureActions) {
    const entries = normalizeRuleEntries(source[action]);
    if (entries.length) overrides[action] = entries;
  }
  return overrides;
}

// 这个功能的全部规则（含隐藏的，管理员要看到）：内置的按原顺序、套上修改，新增的排在后面。
export function resolveRules(action: AiFeatureAction, overrides: RuleOverrides): ResolvedRule[] {
  const entries = overrides[action] ?? [];
  const builtins = aiFeatureActionMeta[action].rulePresets;
  const builtinIds = new Set(builtins.map((preset) => preset.id));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return [
    ...builtins.map((preset) => {
      const entry = byId.get(preset.id);
      const label = entry?.label ?? preset.label;
      const instructions = entry?.instructions ?? preset.instructions;
      return { id: preset.id, label, instructions, builtin: true, modified: label !== preset.label || instructions !== preset.instructions, hidden: Boolean(entry?.hidden) };
    }),
    ...entries.filter((entry) => !builtinIds.has(entry.id)).map((entry) => ({ ...entry, builtin: false, modified: false, hidden: Boolean(entry.hidden) })),
  ];
}

// 用户没选过时默认用 SuYan 的默认规则；它被隐藏了就用第一条还能用的。选中的规则只算没隐藏的。
export function selectedRuleIds(action: AiFeatureAction, rules: ResolvedRule[], chosen: string[] | undefined) {
  const visible = rules.filter((rule) => !rule.hidden).map((rule) => rule.id);
  if (chosen) return chosen.filter((id) => visible.includes(id));
  const fallback = aiFeatureActionMeta[action].defaultRulePreset.id;
  return visible.includes(fallback) ? [fallback] : visible.slice(0, 1);
}

// 和 SuYan 的 buildAiActionInstructions 拼法一样；不直接用它，因为它会把提示词优化的默认规则换回 SuYan 原文。
export function buildRuleInstructions(rules: ResolvedRule[], selectedIds: string[], customInstructions = '') {
  return [...rules.filter((rule) => selectedIds.includes(rule.id)).map((rule) => `【${rule.label}】\n${rule.instructions}`), customInstructions.trim()]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, AI_COMBINED_INSTRUCTIONS_MAX_LENGTH);
}
