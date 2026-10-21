// API 配置 › 功能规则：勾选这个功能要用的规则，点开能看完整内容。管理员（1.17.0）还能改内容、新增、隐藏、恢复默认，
// 改动写进 Supabase 表 ai_rule_overrides，所有登录的账号都按它用（主进程合并逻辑在 electron/materials/aiRules.ts）。
import { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { loadAiRuleOverrides, saveAiRuleOverrides } from '../../cloudSync';

type AiRulesPanelProps = {
  action: MaterialAiAction;
  isAdmin: boolean;
  onSelect: (ids: string[]) => void;
  onRulesChanged: (settings: MaterialAiSettings) => void;
};

type Draft = { id: string | null; label: string; instructions: string };

// 存进云端的条目：内置规则只存改过或隐藏的，新增的全存。
const entriesOf = (rules: MaterialAiRule[]): MaterialAiRuleEntry[] =>
  rules
    .filter((rule) => !rule.builtin || rule.modified || rule.hidden)
    .map(({ id, label, instructions, hidden }) => (hidden ? { id, label, instructions, hidden } : { id, label, instructions }));

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AiRulesPanel({ action, isAdmin, onSelect, onRulesChanged }: AiRulesPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rules = isAdmin ? action.presets : action.presets.filter((rule) => !rule.hidden);

  const commit = async (entries: MaterialAiRuleEntry[]) => {
    const api = window.promptAssistantDesktop?.materials;
    if (!api) return false;
    setBusy(true);
    setError('');
    try {
      await saveAiRuleOverrides(action.action, entries);
      onRulesChanged(await api.aiSetRuleOverrides(await loadAiRuleOverrides()));
      return true;
    } catch (caught) {
      setError(`规则没保存：${messageOf(caught)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleOpen = (rule: MaterialAiRule) => {
    setError('');
    if (openId === rule.id) {
      setOpenId(null);
      setDraft(null);
      return;
    }
    setOpenId(rule.id);
    setDraft({ id: rule.id, label: rule.label, instructions: rule.instructions });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const label = draft.label.trim();
    const instructions = draft.instructions.trim();
    if (!label || !instructions) {
      setError('规则名称和内容都要填');
      return;
    }
    const next = draft.id
      ? rules.map((rule) => (rule.id === draft.id ? { ...rule, label, instructions, modified: true } : rule))
      : [...rules, { id: `custom-${Date.now().toString(36)}`, label, instructions, builtin: false, modified: false, hidden: false }];
    if (await commit(entriesOf(next))) {
      setOpenId(null);
      setDraft(null);
    }
  };

  const toggleHidden = (rule: MaterialAiRule) => void commit(entriesOf(rules.map((entry) => (entry.id === rule.id ? { ...entry, hidden: !entry.hidden } : entry))));
  // 恢复默认：去掉对这条内置规则的全部改动（内容和隐藏）。
  const restore = (rule: MaterialAiRule) => void commit(entriesOf(rules).filter((entry) => entry.id !== rule.id)).then((ok) => ok && setOpenId(null));
  const remove = (rule: MaterialAiRule) => {
    if (!window.confirm(`删除规则「${rule.label}」？所有账号都不能再用它。`)) return;
    void commit(entriesOf(rules.filter((entry) => entry.id !== rule.id))).then((ok) => ok && setOpenId(null));
  };

  const editor = (rule: MaterialAiRule | null) =>
    draft && (
      <div className="ai-rule-editor">
        {isAdmin && (
          <label className="field">
            规则名称
            <input value={draft.label} maxLength={80} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
          </label>
        )}
        <label className="field">
          {isAdmin ? '规则内容（发给模型的要求）' : '规则内容'}
          <textarea
            value={draft.instructions}
            readOnly={!isAdmin}
            rows={12}
            maxLength={12000}
            onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
          />
        </label>
        {isAdmin && (
          <div className="ai-rule-editor-actions">
            {rule?.builtin && rule.modified && (
              <Button className="button ghost compact" type="button" disabled={busy} onClick={() => restore(rule)} title="内容换回素言自带的版本">
                <RotateCcw size={13} />
                恢复默认
              </Button>
            )}
            {rule && !rule.builtin && (
              <Button className="button ghost compact danger" type="button" disabled={busy} onClick={() => remove(rule)}>
                <Trash2 size={13} />
                删除
              </Button>
            )}
            <span className="ref-editor-spacer" />
            <Button
              className="button ghost compact"
              type="button"
              onClick={() => {
                setOpenId(null);
                setDraft(null);
                setError('');
              }}
            >
              取消
            </Button>
            <Button className="button primary compact" type="button" disabled={busy} onClick={() => void saveDraft()}>
              {busy ? '正在保存…' : rule ? '保存规则' : '添加规则'}
            </Button>
          </div>
        )}
      </div>
    );

  return (
    <div className="ai-rules" role="group" aria-label="预设规则">
      {rules.map((rule) => {
        const open = openId === rule.id;
        return (
          <div key={rule.id} className={`ai-rule ${rule.hidden ? 'is-hidden' : ''} ${open ? 'is-open' : ''}`}>
            <div className="ai-rule-row">
              <label className="ai-preset">
                <input
                  type="checkbox"
                  disabled={rule.hidden}
                  checked={!rule.hidden && action.rulePresetIds.includes(rule.id)}
                  onChange={(event) =>
                    onSelect(event.target.checked ? [...action.rulePresetIds, rule.id] : action.rulePresetIds.filter((id) => id !== rule.id))
                  }
                />
                {rule.label}
              </label>
              {isAdmin && !rule.builtin && <span className="ai-rule-badge">新增</span>}
              {isAdmin && rule.modified && <span className="ai-rule-badge">已修改</span>}
              {rule.hidden && <span className="ai-rule-badge is-muted">已隐藏，用户看不到</span>}
              <span className="ref-editor-spacer" />
              {isAdmin && (
                <Button
                  className="icon-button"
                  type="button"
                  disabled={busy}
                  aria-label={rule.hidden ? `显示「${rule.label}」` : `隐藏「${rule.label}」`}
                  title={rule.hidden ? '显示：所有账号都能选它' : '隐藏：所有账号都看不到、用不了它'}
                  onClick={() => toggleHidden(rule)}
                >
                  {rule.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                </Button>
              )}
              <Button className="button ghost compact" type="button" aria-expanded={open} onClick={() => toggleOpen(rule)}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {isAdmin ? '查看 / 编辑' : '查看内容'}
              </Button>
            </div>
            {open && editor(rule)}
          </div>
        );
      })}
      {isAdmin &&
        (openId === 'new' ? (
          <div className="ai-rule is-open">{editor(null)}</div>
        ) : (
          <Button
            className="button ghost compact ai-rule-add"
            type="button"
            onClick={() => {
              setError('');
              setOpenId('new');
              setDraft({ id: null, label: '', instructions: '' });
            }}
          >
            <Plus size={13} />
            新增规则
          </Button>
        ))}
      {error && (
        <p className="canvas-detail-error" role="alert">
          {error}
        </p>
      )}
      {isAdmin && <p className="nas-form-note">你是管理员：这里改的规则保存后立刻写到云端，所有登录的账号都按它用；勾选哪几条仍是每台电脑自己选，点下面「保存 API 配置」生效。</p>}
    </div>
  );
}
