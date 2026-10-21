import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';

type SlotDraft = MaterialAiSlotInput & { hasApiKey: boolean };
type ModelOption = { id: string; vision: boolean; generation: boolean };

const SLOT_LABELS: Record<MaterialAiSlotName, { title: string; note: string }> = {
  text: { title: '文本模型', note: '用于优化、翻译，以及没有视觉模型时按提示词分类。不填就用视觉模型。' },
  vision: { title: '视觉模型', note: '用于图像反推和看图分类打标签，要选能看图的模型，比如 qwen-vl、gpt-4o、qwen2.5vl。' },
  image: {
    title: '生图模型',
    note: '用于创作画布，只支持 OpenAI 兼容的 /images 接口，比如 grok-imagine-image、gpt-image、Agnes；Agnes Video 模型可以生成视频。超时、断网、限流这类临时失败会自动重试，服务商那边可能已经扣过费；参数或 Key 错误不重试。',
  },
};
const SLOTS: MaterialAiSlotName[] = ['text', 'vision', 'image'];

// 模型能力是按接口字段或模型名推断的，认不出时不代表没有这个能力。
const capabilityLabel = (name: MaterialAiSlotName, model: ModelOption) =>
  name === 'image' ? (model.generation ? '能生图' : '没认出能不能生图') : model.vision ? '能看图' : '没认出能不能看图';
const capabilityNote = (name: MaterialAiSlotName, models: ModelOption[]) =>
  name === 'image'
    ? ` 查到 ${models.length} 个模型，其中 ${models.filter((model) => model.generation).length} 个认得出能生图（按模型名推断，没认出的也可能能生图），在「从查到的模型里选」里选。`
    : ` 查到 ${models.length} 个模型，其中 ${models.filter((model) => model.vision).length} 个认得出能看图（按模型名推断，没认出的也可能能看图，用测试连接或直接反推试一下），在「从查到的模型里选」里选。`;

// 搜模型名：不分大小写，空格分开的几个词都要出现。
const matchModels = (models: ModelOption[], query: string) => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? models.filter((model) => words.every((word) => model.id.toLowerCase().includes(word))) : models;
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

// 这一块和已保存的不一样（填了新 Key 也算）。
const slotChanged = (draft: SlotDraft, saved: MaterialAiSlot | null) => {
  const base = draftOf(saved);
  return draft.provider !== base.provider || draft.baseUrl.trim() !== base.baseUrl || draft.model.trim() !== base.model || Boolean(draft.apiKey);
};

type Drafts = { slots: Record<MaterialAiSlotName, SlotDraft>; actions: MaterialAiAction[]; canvas: MaterialCanvasOptions };
// 切到别的设置分区时表单会卸载。没保存的改动和查到的模型留在这里，切回来接着用；软件关了就没了。
// 草稿只在已保存的设置没被别处改过时才沿用（比如画布的模型下拉会直接改生图模型），否则作废。
let kept: { baseline: string; drafts: Drafts } | null = null;
let keptModels: Record<MaterialAiSlotName, ModelOption[]> = { text: [], vision: [], image: [] };

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
  const [saved, setSaved] = useState<MaterialAiSettings | null>(null);
  const [droppedDraft, setDroppedDraft] = useState(false);
  const [models, setModels] = useState<Record<MaterialAiSlotName, ModelOption[]>>(keptModels);
  const [modelQuery, setModelQuery] = useState<Record<MaterialAiSlotName, string>>({ text: '', vision: '', image: '' });
  const [actionIndex, setActionIndex] = useState(0);
  const [canvasOptions, setCanvasOptions] = useState<MaterialCanvasOptions>({ concurrency: 2, retries: 2 });

  const load = (settings: MaterialAiSettings, drafts?: Drafts) => {
    setSaved(settings);
    setSlots(drafts?.slots ?? { text: draftOf(settings.text), vision: draftOf(settings.vision), image: draftOf(settings.image) });
    setActions(drafts?.actions ?? settings.actions);
    setCanvasOptions(drafts?.canvas ?? settings.canvas);
  };

  // 只在打开时读一次：getSettings 每次渲染都是新函数。
  useEffect(() => {
    void getSettings().then((settings) => {
      const usable = kept && kept.baseline === JSON.stringify(settings);
      if (kept && !usable) setDroppedDraft(true);
      load(settings, usable ? kept!.drafts : undefined);
    });
  }, []);

  const dirty =
    Boolean(saved && slots) &&
    (SLOTS.some((name) => slotChanged(slots![name], saved![name])) ||
      JSON.stringify(actions) !== JSON.stringify(saved!.actions) ||
      JSON.stringify(canvasOptions) !== JSON.stringify(saved!.canvas));
  useEffect(() => {
    // 还没读到已保存的设置时不动它，否则一挂载就把上次留下的草稿清掉了
    if (!saved || !slots) return;
    kept = dirty ? { baseline: JSON.stringify(saved), drafts: { slots, actions, canvas: canvasOptions } } : null;
  });
  useEffect(() => {
    keptModels = models;
  }, [models]);

  if (!slots || !saved) return null;

  const setSlot = (name: MaterialAiSlotName, patch: Partial<SlotDraft>) => setSlots({ ...slots, [name]: { ...slots[name], ...patch } });
  const action = actions[actionIndex];
  const setAction = (patch: Partial<MaterialAiAction>) => setActions(actions.map((entry, index) => (index === actionIndex ? { ...entry, ...patch } : entry)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await saveSettings({
      text: inputOf(slots.text),
      vision: inputOf(slots.vision),
      image: inputOf(slots.image),
      canvas: canvasOptions,
      actions: Object.fromEntries(actions.map((entry) => [entry.action, { rulePresetIds: entry.rulePresetIds, customInstructions: entry.customInstructions }])),
    });
    if (saved) {
      setDroppedDraft(false);
      load(saved);
    }
  };

  const queryModels = async (name: MaterialAiSlotName) => {
    const found = await listModels(name, inputOf(slots[name]));
    if (found) setModels({ ...models, [name]: found });
  };

  return (
    <form className="nas-form" onSubmit={(event) => void submit(event)}>
      {droppedDraft && <p className="nas-form-note">上次离开时没保存的改动已作废：API 配置在别处改过了（比如画布里换了生图模型）。</p>}
      {SLOTS.map((name) => {
        const slot = slots[name];
        const savedModel = saved[name]?.model ?? '';
        const changed = slotChanged(slot, saved[name]);
        return (
          <fieldset key={name} className="ai-slot">
            <legend>{SLOT_LABELS[name].title}</legend>
            {/* 当前状态：已保存的模型、没保存的改动、还没设置，样式照 NAS 的连接状态 */}
            <div className={`nas-status ${changed ? 'is-unsaved' : savedModel ? 'is-connected' : ''}`} role="status">
              <span className="nas-status-line">
                <span className="nas-status-dot" aria-hidden="true" />
                {changed ? (
                  <>
                    <strong>未保存</strong>：{slot.model.trim() || '（没填模型）'}
                  </>
                ) : savedModel ? (
                  <>
                    <strong>已保存</strong>：{savedModel}
                  </>
                ) : (
                  <strong>未设置</strong>
                )}
              </span>
              {changed && <p className="nas-status-detail">点「保存」才生效{savedModel ? `，现在用的还是 ${savedModel}` : ''}。</p>}
            </div>
            {name !== 'image' && (
              <label className="field">
                接口类型
                <select value={slot.provider} onChange={(event) => setSlot(name, { provider: event.target.value as MaterialAiProvider })}>
                  <option value="openai-compatible">OpenAI 兼容接口（DeepSeek、通义、豆包、OpenAI 等）</option>
                  <option value="ollama">本机 Ollama</option>
                </select>
              </label>
            )}
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
              <input value={slot.model} onChange={(event) => setSlot(name, { model: event.target.value })} spellCheck={false} />
            </label>
            {/* 不用 datalist：Electron 里它的弹出列表只显示一部分、滚轮滚不动。原生下拉框能完整滚动。
                网关返回的模型可能有几百个：先搜，有搜索词时直接展开成列表（最多 8 行），点一下就选上。 */}
            {models[name].length > 0 && (() => {
              const query = modelQuery[name];
              const matched = matchModels(models[name], query);
              return (
                <div className="field">
                  从查到的模型里选
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setModelQuery({ ...modelQuery, [name]: event.target.value })}
                    placeholder={`搜索 ${models[name].length} 个模型，比如 gpt、image、vl`}
                    aria-label={`搜索${SLOT_LABELS[name].title}`}
                    spellCheck={false}
                  />
                  {matched.length > 0 ? (
                    <select
                      aria-label={`选择${SLOT_LABELS[name].title}`}
                      size={query.trim() ? Math.min(8, Math.max(2, matched.length)) : undefined}
                      value={matched.some((model) => model.id === slot.model) ? slot.model : ''}
                      onChange={(event) => event.target.value && setSlot(name, { model: event.target.value })}
                      // 展开成列表时值对不上任何一项，React 会把第一项标成选中，点它不触发 change（1.10.4 主人实测选不上），所以直接认点到的那一项。
                      onClick={(event) => {
                        const option = event.target as HTMLElement;
                        if (option instanceof HTMLOptionElement && option.value) setSlot(name, { model: option.value });
                      }}
                    >
                      {!query.trim() && <option value="">共 {models[name].length} 个，点开选择…</option>}
                      {matched.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}（{capabilityLabel(name, model)}）
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="nas-form-note">没有名字里带「{query.trim()}」的模型</span>
                  )}
                  {query.trim() && matched.length > 0 && <span className="nas-form-note">找到 {matched.length} 个（共 {models[name].length} 个），点一下选上</span>}
                </div>
              );
            })()}
            {name === 'image' && (
              <div className="canvas-row">
                <label className="field">
                  同时生成
                  <select value={canvasOptions.concurrency} onChange={(event) => setCanvasOptions({ ...canvasOptions, concurrency: Number(event.target.value) })}>
                    {[1, 2, 3, 4].map((count) => (
                      <option key={count} value={count}>
                        {count} 张
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  失败自动重试
                  <select value={canvasOptions.retries} onChange={(event) => setCanvasOptions({ ...canvasOptions, retries: Number(event.target.value) })}>
                    {[0, 1, 2, 3, 4, 5].map((count) => (
                      <option key={count} value={count}>
                        {count ? `${count} 次` : '不重试'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <p className="nas-form-note">
              {SLOT_LABELS[name].note}
              {models[name].length > 0 && capabilityNote(name, models[name])}
            </p>
            <div className="nas-form-actions">
              <Button className="button ghost compact" type="button" disabled={busy || !slot.baseUrl.trim()} onClick={() => void queryModels(name)}>
                查询模型
              </Button>
              <Button className="button ghost compact" type="button" disabled={busy || !slot.baseUrl.trim() || !slot.model.trim()} onClick={() => void testModel(name, inputOf(slot))}>
                测试连接
              </Button>
              <Button className="button primary compact" type="submit" disabled={busy || !changed} title="保存整页 API 配置（三个模型和功能规则）">
                保存
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
          保存 API 配置
        </Button>
      </div>
    </form>
  );
}
