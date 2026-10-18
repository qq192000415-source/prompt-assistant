import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';

type SlotDraft = MaterialAiSlotInput & { hasApiKey: boolean };
type ModelOption = { id: string; vision: boolean };

const SLOT_LABELS: Record<MaterialAiSlotName, { title: string; note: string }> = {
  text: { title: '文本模型', note: '用于优化、翻译，以及没有视觉模型时按提示词分类。不填就用视觉模型。' },
  vision: { title: '视觉模型', note: '用于图像反推和看图分类打标签，要选能看图的模型，比如 qwen-vl、gpt-4o、qwen2.5vl。' },
};

const URL_PLACEHOLDER: Record<MaterialAiProvider, string> = {
  'openai-compatible': 'https://api.deepseek.com/v1',
  ollama: 'http://127.0.0.1:11434',
};

const draftOf = (slot: MaterialAiSlot | null): SlotDraft => ({
  provider: slot?.provider ?? 'openai-compatible',
  baseUrl: slot?.baseUrl ?? '',
  model: slot?.model ?? '',
  apiKey: '',
  hasApiKey: slot?.hasApiKey ?? false,
});

// 发给主进程的模型设置；Key 留空表示沿用已保存的。
const inputOf = ({ hasApiKey: _hasApiKey, ...slot }: SlotDraft): MaterialAiSlotInput => slot;

type AiSettingsFormProps = {
  busy: boolean;
  getSettings: () => Promise<MaterialAiSettings>;
  saveSettings: (settings: MaterialAiSettingsInput) => Promise<MaterialAiSettings | null>;
  listModels: (slot: MaterialAiSlotName, input: MaterialAiSlotInput) => Promise<ModelOption[] | null>;
  testModel: (slot: MaterialAiSlotName, input: MaterialAiSlotInput) => Promise<void>;
};

export function AiSettingsForm({ busy, getSettings, saveSettings, listModels, testModel }: AiSettingsFormProps) {
  const [slots, setSlots] = useState<Record<MaterialAiSlotName, SlotDraft> | null>(null);
  const [actions, setActions] = useState<MaterialAiAction[]>([]);
  const [models, setModels] = useState<Record<MaterialAiSlotName, ModelOption[]>>({ text: [], vision: [] });
  const [actionIndex, setActionIndex] = useState(0);

  const load = (settings: MaterialAiSettings) => {
    setSlots({ text: draftOf(settings.text), vision: draftOf(settings.vision) });
    setActions(settings.actions);
  };

  // 只在打开时读一次：getSettings 每次渲染都是新函数。
  useEffect(() => {
    void getSettings().then(load);
  }, []);

  if (!slots) return null;

  const setSlot = (name: MaterialAiSlotName, patch: Partial<SlotDraft>) => setSlots({ ...slots, [name]: { ...slots[name], ...patch } });
  const action = actions[actionIndex];
  const setAction = (patch: Partial<MaterialAiAction>) => setActions(actions.map((entry, index) => (index === actionIndex ? { ...entry, ...patch } : entry)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await saveSettings({
      text: inputOf(slots.text),
      vision: inputOf(slots.vision),
      actions: Object.fromEntries(actions.map((entry) => [entry.action, { rulePresetIds: entry.rulePresetIds, customInstructions: entry.customInstructions }])),
    });
    if (saved) load(saved);
  };

  const queryModels = async (name: MaterialAiSlotName) => {
    const found = await listModels(name, inputOf(slots[name]));
    if (found) setModels({ ...models, [name]: found });
  };

  return (
    <form className="nas-form" onSubmit={(event) => void submit(event)}>
      {(['text', 'vision'] as const).map((name) => {
        const slot = slots[name];
        const listId = `ai-models-${name}`;
        return (
          <fieldset key={name} className="ai-slot">
            <legend>{SLOT_LABELS[name].title}</legend>
            <label className="field">
              接口类型
              <select value={slot.provider} onChange={(event) => setSlot(name, { provider: event.target.value as MaterialAiProvider })}>
                <option value="openai-compatible">OpenAI 兼容接口（DeepSeek、通义、豆包、OpenAI 等）</option>
                <option value="ollama">本机 Ollama</option>
              </select>
            </label>
            <label className="field">
              接口地址
              <input
                value={slot.baseUrl}
                onChange={(event) => setSlot(name, { baseUrl: event.target.value })}
                placeholder={URL_PLACEHOLDER[slot.provider]}
                inputMode="url"
                spellCheck={false}
              />
            </label>
            {slot.provider === 'openai-compatible' && (
              <label className="field">
                API Key
                <input
                  type="password"
                  value={slot.apiKey}
                  onChange={(event) => setSlot(name, { apiKey: event.target.value })}
                  placeholder={slot.hasApiKey ? '已保存，不改就留空' : ''}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            )}
            <label className="field">
              模型
              <input value={slot.model} onChange={(event) => setSlot(name, { model: event.target.value })} list={listId} spellCheck={false} />
              <datalist id={listId}>
                {models[name].map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.vision ? '能看图' : '没认出能不能看图'}
                  </option>
                ))}
              </datalist>
            </label>
            <p className="nas-form-note">
              {SLOT_LABELS[name].note}
              {models[name].length > 0 && ` 查到 ${models[name].length} 个模型，其中 ${models[name].filter((model) => model.vision).length} 个认得出能看图（按模型名推断，没认出的也可能能看图，用测试连接或直接反推试一下），在模型框里选。`}
            </p>
            <div className="nas-form-actions">
              <Button className="button ghost compact" type="button" disabled={busy || !slot.baseUrl.trim()} onClick={() => void queryModels(name)}>
                查询模型
              </Button>
              <Button className="button ghost compact" type="button" disabled={busy || !slot.baseUrl.trim() || !slot.model.trim()} onClick={() => void testModel(name, inputOf(slot))}>
                测试连接
              </Button>
            </div>
          </fieldset>
        );
      })}

      {action && (
        <fieldset className="ai-slot">
          <legend>功能规则</legend>
          <label className="field">
            功能
            <select value={actionIndex} onChange={(event) => setActionIndex(Number(event.target.value))}>
              {actions.map((entry, index) => (
                <option key={entry.action} value={index}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <p className="nas-form-note">{action.description}</p>
          <div className="ai-presets" role="group" aria-label="预设规则">
            {action.presets.map((preset) => (
              <label key={preset.id} className="ai-preset">
                <input
                  type="checkbox"
                  checked={action.rulePresetIds.includes(preset.id)}
                  onChange={(event) =>
                    setAction({
                      rulePresetIds: event.target.checked
                        ? [...action.rulePresetIds, preset.id]
                        : action.rulePresetIds.filter((id) => id !== preset.id),
                    })
                  }
                />
                {preset.label}
              </label>
            ))}
          </div>
          <label className="field">
            补充规则
            <textarea
              value={action.customInstructions}
              onChange={(event) => setAction({ customInstructions: event.target.value })}
              placeholder={action.placeholder}
              rows={3}
            />
          </label>
        </fieldset>
      )}

      <p className="nas-form-note">设置和 API Key 只保存在这台电脑上，Key 用系统加密，不会传到 NAS。规则和预设来自素言（SuYan）。</p>
      <div className="nas-form-actions">
        <Button className="button primary" type="submit" disabled={busy}>
          保存 AI 设置
        </Button>
      </div>
    </form>
  );
}
