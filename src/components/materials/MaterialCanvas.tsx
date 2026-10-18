import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, ClipboardPaste, Download, ImagePlus, RotateCcw, Save, Settings, Sparkles, Wand2, X } from 'lucide-react';
import { Button } from '../ui/button';
import type { MaterialLibraryController } from '../../materials/useMaterialLibrary';
import { canvas, isVideoModel, unsavedCount, useCanvasState, type CanvasBatch, type CanvasResult } from '../../materials/canvasStore';
import {
  canvasAspectRatioOptions,
  extractPromptKeywords,
  getCanvasGenerationSizeLabel,
  maxCanvasPromptLength,
  resolveCanvasGenerationSize,
} from '../../materials/suyan/canvasGeneration.ts';
import type { CanvasBaseResolution, CanvasSizeMode } from '../../materials/suyan/canvasTypes.ts';

const SIZE_MODES: Array<{ value: CanvasSizeMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'ratio', label: '按比例' },
  { value: 'custom', label: '自定义' },
];
const RESOLUTIONS: Array<{ value: CanvasBaseResolution; label: string }> = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];
const REVEAL_MS = 900;

// 等待时按已用时间换说法，和 SuYan 的「思考 → 生成」两段一致。
const waitingLabel = (seconds: number) => (seconds < 4 ? '正在理解提示词' : seconds < 40 ? '正在生成画面' : '还在生成，复杂画面会久一些');

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

type Segment<T extends string> = { value: T; label: string };

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Segment<T>[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="canvas-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'is-active' : ''} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

type MaterialCanvasProps = {
  controller: MaterialLibraryController;
  // 设置弹窗关掉时重新读一次生图模型。
  settingsOpen: boolean;
  onOpenSettings: () => void;
};

export function MaterialCanvas({ controller, settingsOpen, onOpenSettings }: MaterialCanvasProps) {
  const { draft, phase, batches, error, startedAt } = useCanvasState();
  const [model, setModel] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = Boolean(controller.busy);
  const generating = phase === 'generating';
  const video = Boolean(model && isVideoModel(model));
  const sizeLabel = getCanvasGenerationSizeLabel(resolveCanvasGenerationSize(draft));
  const keywords = useMemo(() => extractPromptKeywords(draft.prompt), [draft.prompt]);
  const [latest, ...earlier] = batches;
  const unsaved = unsavedCount(batches);

  useEffect(() => {
    if (settingsOpen) return;
    void controller
      .aiGetSettings()
      .then((settings) => setModel(settings.image?.usable ? settings.image.model : ''))
      .catch(() => setModel(''));
  }, [settingsOpen]);

  useEffect(() => {
    if (!generating) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    if (phase !== 'reveal') return undefined;
    const timer = window.setTimeout(() => canvas.revealDone(), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // 画布里按 Ctrl+V：剪贴板里有图就加成参考图；输入框里的粘贴照常。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') || viewing) return;
      if (!event.clipboardData?.types.some((type) => type.startsWith('image/') || type === 'Files')) return;
      event.preventDefault();
      void pasteReference();
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [viewing]);

  const pasteReference = async () => {
    const dataUrl = await controller.canvasClipboardImage();
    if (dataUrl) canvas.addReferences([{ fileName: '', title: '剪贴板图片', dataUrl }]);
  };

  const pickReferences = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    canvas.addReferences(await Promise.all(files.map(async (file) => ({ fileName: '', title: file.name, dataUrl: await readAsDataUrl(file) }))));
  };

  const optimize = async (key: 'prompt' | 'negativePrompt') => {
    const optimized = await controller.aiOptimize(draft[key], key === 'prompt' ? 'positive' : 'negative');
    if (optimized) canvas.setDraft({ [key]: optimized });
  };

  const generate = () => {
    if (!model) return;
    void canvas.generate(model, controller.canvasGenerate);
  };

  const save = async (batch: CanvasBatch, result: CanvasResult) => {
    if (await controller.canvasSave({ dataUrl: result.dataUrl, prompt: batch.prompt, negativePrompt: batch.negativePrompt, origin: batch.origin })) canvas.markSaved(result.id);
  };

  const all = batches.flatMap((batch) => batch.results.map((result) => ({ batch, result })));
  const resultActions = (batch: CanvasBatch, result: CanvasResult) => (
    <div className="canvas-result-actions">
      <Button className="button ghost compact" type="button" disabled={busy || result.saved} onClick={() => void save(batch, result)}>
        {result.saved ? <Check size={13} /> : <Save size={13} />}
        {result.saved ? '已存入' : '存入素材库'}
      </Button>
      <Button className="button ghost compact" type="button" disabled={busy} onClick={() => void controller.canvasSaveAs(result.dataUrl)}>
        <Download size={13} />
        另存为
      </Button>
      <Button className="button ghost compact" type="button" title="把生成这张图用的提示词放回左边" onClick={() => canvas.reusePrompt(batch, result)}>
        <RotateCcw size={13} />
        复用提示词
      </Button>
    </div>
  );

  const media = (result: CanvasResult, className = '') =>
    result.mediaType === 'video' ? (
      <video className={className} src={result.dataUrl} controls playsInline />
    ) : (
      <img className={className} src={result.dataUrl} alt="生成结果" />
    );

  return (
    <div className="canvas-layout">
      <form
        className="canvas-panel"
        onSubmit={(event) => {
          event.preventDefault();
          generate();
        }}
      >
        <label className="field" htmlFor="canvas-prompt">
          <span className="material-field-label">
            正向提示词
            <span className="material-field-tools">
              <Button className="button ghost compact" type="button" disabled={busy || !draft.prompt.trim()} onClick={() => void optimize('prompt')}>
                <Wand2 size={13} />
                优化
              </Button>
              <Button className="button ghost compact" type="button" disabled={!draft.prompt} onClick={() => canvas.setDraft({ prompt: '' })}>
                清空
              </Button>
            </span>
          </span>
          <textarea id="canvas-prompt" value={draft.prompt} maxLength={maxCanvasPromptLength} rows={8} onChange={(event) => canvas.setDraft({ prompt: event.target.value })} placeholder="描述想要的画面" />
          <span className="canvas-count">
            {draft.prompt.length} / {maxCanvasPromptLength}
          </span>
        </label>

        <div className="canvas-section">
          <span className="material-field-label">
            参考图{draft.referenceImages.length ? ` ${draft.referenceImages.length} 张` : ''}
            <span className="material-field-tools">
              <Button className="button ghost compact" type="button" onClick={() => fileInput.current?.click()}>
                <ImagePlus size={13} />
                本机图片
              </Button>
              <Button className="button ghost compact" type="button" disabled={busy} onClick={() => void pasteReference()} title="也可以直接按 Ctrl+V">
                <ClipboardPaste size={13} />
                粘贴
              </Button>
            </span>
          </span>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => void pickReferences(event)} />
          {draft.referenceImages.length > 0 ? (
            <div className="canvas-references">
              {draft.referenceImages.map((reference, index) => (
                <div key={index} className="canvas-reference" title={reference.title}>
                  <img src={reference.dataUrl} alt={reference.title} />
                  <button type="button" aria-label={`移除参考图 ${reference.title}`} onClick={() => canvas.removeReference(index)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="nas-form-note">有参考图时按图生图。也可以在素材详情里点「发到画布」带图过来。</p>
          )}
        </div>

        <div className="canvas-section">
          <span className="material-field-label">
            <button type="button" className="canvas-toggle" aria-expanded={!draft.negativePromptHidden} onClick={() => canvas.setDraft({ negativePromptHidden: !draft.negativePromptHidden })}>
              负向提示词{draft.negativePromptHidden && draft.negativePrompt ? '（已填写）' : ''}
            </button>
            {!draft.negativePromptHidden && (
              <Button className="button ghost compact" type="button" disabled={busy || !draft.negativePrompt.trim()} onClick={() => void optimize('negativePrompt')}>
                <Wand2 size={13} />
                优化
              </Button>
            )}
          </span>
          {!draft.negativePromptHidden && (
            <textarea aria-label="负向提示词" value={draft.negativePrompt} maxLength={maxCanvasPromptLength} rows={3} onChange={(event) => canvas.setDraft({ negativePrompt: event.target.value })} placeholder="不想出现的内容" />
          )}
        </div>

        <div className="canvas-section">
          <span className="material-field-label">
            尺寸
            <span className="canvas-size-label">{sizeLabel}</span>
          </span>
          <Segmented label="尺寸方式" value={draft.sizeMode} options={SIZE_MODES} onChange={(sizeMode) => canvas.setDraft({ sizeMode })} />
          {draft.sizeMode === 'ratio' && (
            <>
              <Segmented label="分辨率" value={draft.baseResolution} options={RESOLUTIONS} onChange={(baseResolution) => canvas.setDraft({ baseResolution })} />
              <div className="canvas-ratios" role="radiogroup" aria-label="比例">
                {canvasAspectRatioOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={draft.aspectRatio === option.value}
                    className={draft.aspectRatio === option.value ? 'is-active' : ''}
                    onClick={() => canvas.setDraft({ aspectRatio: option.value })}
                  >
                    <span className={`canvas-ratio-shape is-${option.orientation}`} style={{ aspectRatio: option.value.replace(':', ' / ') }} aria-hidden="true" />
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {draft.sizeMode === 'custom' && (
            <div className="canvas-custom-size">
              <label className="field">
                宽
                <input type="number" min={256} max={8192} step={8} value={draft.customWidth} onChange={(event) => canvas.setDraft({ customWidth: Number(event.target.value) })} />
              </label>
              <label className="field">
                高
                <input type="number" min={256} max={8192} step={8} value={draft.customHeight} onChange={(event) => canvas.setDraft({ customHeight: Number(event.target.value) })} />
              </label>
            </div>
          )}
        </div>

        {video ? (
          <div className="canvas-section canvas-row">
            <label className="field">
              视频时长
              <select value={draft.videoSeconds} onChange={(event) => canvas.setDraft({ videoSeconds: Number(event.target.value) })}>
                {Array.from({ length: 9 }, (_, index) => index + 4).map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} 秒
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              分辨率
              <select value={draft.videoSize} disabled={/flash$/i.test(model ?? '')} onChange={(event) => canvas.setDraft({ videoSize: event.target.value as typeof draft.videoSize })}>
                <option value="720P">720P</option>
                <option value="960P">960P</option>
                <option value="2K">2K</option>
              </select>
            </label>
          </div>
        ) : (
          <details className="canvas-section canvas-advanced" open={draft.advancedSettingsOpen} onToggle={(event) => canvas.setDraft({ advancedSettingsOpen: event.currentTarget.open })}>
            <summary>高级设置</summary>
            <div className="canvas-row">
              <label className="field">
                质量
                <select value={draft.quality} onChange={(event) => canvas.setDraft({ quality: event.target.value as typeof draft.quality })}>
                  <option value="auto">自动</option>
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
              </label>
              <label className="field">
                格式
                <select value={draft.outputFormat} onChange={(event) => canvas.setDraft({ outputFormat: event.target.value as typeof draft.outputFormat })}>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
            </div>
            <Segmented
              label="张数"
              value={String(draft.count) as '1' | '2' | '3' | '4'}
              options={(['1', '2', '3', '4'] as const).map((count) => ({ value: count, label: `${count} 张` }))}
              onChange={(count) => canvas.setDraft({ count: Number(count) })}
            />
            <label className="ai-preset">
              <input type="checkbox" checked={draft.transparentBackground} onChange={(event) => canvas.setDraft({ transparentBackground: event.target.checked })} />
              透明背景（选 JPEG 时会改用 PNG；要模型支持）
            </label>
          </details>
        )}

        <div className="canvas-footer">
          {model === '' ? (
            <p className="nas-form-note">
              还没有设置生图模型。
              <button type="button" className="canvas-link" onClick={onOpenSettings}>
                <Settings size={12} />
                去设置
              </button>
            </p>
          ) : (
            model && <p className="nas-form-note">生图模型：{model}{video ? '（生成视频）' : ''}</p>
          )}
          {error && (
            <p className="canvas-error" role="alert">
              {error}
              <button type="button" aria-label="关闭错误提示" onClick={() => canvas.clearError()}>
                <X size={12} />
              </button>
            </p>
          )}
          <Button className="button primary canvas-generate" type="submit" disabled={generating || !model || !draft.prompt.trim()}>
            <Sparkles size={15} />
            {generating ? '生成中…' : video ? '生成视频' : '生成'}
          </Button>
        </div>
      </form>

      <section className="canvas-stage" aria-label="生成结果">
        {generating ? (
          <div className="canvas-generating" aria-live="polite">
            {draft.referenceImages[0] && <img className="canvas-generating-backdrop" src={draft.referenceImages[0].dataUrl} alt="" />}
            <div className="canvas-scan" aria-hidden="true" />
            <div className="canvas-generating-text">
              <strong>{waitingLabel(Math.floor((now - startedAt) / 1000))}</strong>
              <div className="canvas-keywords">
                {keywords.map((keyword, index) => (
                  <span key={keyword} style={{ animationDelay: `${index * 0.6}s` }}>
                    {keyword}
                  </span>
                ))}
              </div>
              <span>已用 {Math.max(0, Math.floor((now - startedAt) / 1000))} 秒</span>
            </div>
          </div>
        ) : latest ? (
          <div className={`canvas-latest is-count-${Math.min(latest.results.length, 4)} ${phase === 'reveal' ? 'is-revealing' : ''}`}>
            {latest.results.map((result) => (
              <figure key={result.id} className="canvas-result">
                <button type="button" className="canvas-result-media" aria-label="全屏查看" onClick={() => setViewing(result.id)}>
                  {media(result)}
                </button>
                {resultActions(latest, result)}
              </figure>
            ))}
          </div>
        ) : (
          <div className="canvas-empty">
            <Sparkles size={22} aria-hidden="true" />
            <strong>写好提示词，点生成</strong>
            <span>生成的图先在这里预览，满意的点「存入素材库」上传到 NAS；没存的关掉软件就没了。</span>
          </div>
        )}

        {batches.length > 0 && (
          <div className="canvas-history">
            <div className="canvas-history-header">
              <strong>本次生成</strong>
              <span>{unsaved ? `${unsaved} 个结果还没存入素材库，关掉软件后会消失` : '都已存入素材库'}</span>
            </div>
            {earlier.map((batch) => (
              <div key={batch.id} className="canvas-history-row">
                <div className="canvas-history-meta">
                  <span>{new Date(batch.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · {batch.model}</span>
                  <p title={batch.prompt}>{batch.prompt}</p>
                </div>
                <div className="canvas-history-thumbs">
                  {batch.results.map((result) => (
                    <button key={result.id} type="button" className={result.saved ? 'is-saved' : ''} aria-label={result.saved ? '已存入素材库，全屏查看' : '全屏查看'} onClick={() => setViewing(result.id)}>
                      {result.mediaType === 'video' ? <video src={result.dataUrl} muted preload="metadata" /> : <img src={result.dataUrl} alt="" />}
                      {result.saved && <Check size={12} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {viewing && (
        <CanvasViewer
          entries={all}
          currentId={viewing}
          onChange={setViewing}
          onClose={() => setViewing(null)}
          actions={resultActions}
          media={media}
        />
      )}
    </div>
  );
}

type ViewerEntry = { batch: CanvasBatch; result: CanvasResult };

function CanvasViewer({
  entries,
  currentId,
  onChange,
  onClose,
  actions,
  media,
}: {
  entries: ViewerEntry[];
  currentId: string;
  onChange: (id: string) => void;
  onClose: () => void;
  actions: (batch: CanvasBatch, result: CanvasResult) => React.ReactNode;
  media: (result: CanvasResult, className?: string) => React.ReactNode;
}) {
  const index = Math.max(0, entries.findIndex((entry) => entry.result.id === currentId));
  const entry = entries[index];
  const [size, setSize] = useState('');
  const go = (step: number) => onChange(entries[(index + step + entries.length) % entries.length].result.id);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') go(-1);
      else if (event.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!entry) return null;
  return (
    <div className="modal-shell canvas-viewer" role="dialog" aria-modal="true" aria-label="全屏查看">
      <Button className="modal-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      <div className="canvas-viewer-body">
        <div className="canvas-viewer-media" onLoadCapture={(event) => {
          const target = event.target as HTMLImageElement;
          if (target.naturalWidth) setSize(`${target.naturalWidth} × ${target.naturalHeight}`);
        }}>
          {media(entry.result)}
        </div>
        <div className="canvas-viewer-bar">
          <span>
            {index + 1} / {entries.length} · {entry.batch.model}
            {size && entry.result.mediaType === 'image' ? ` · ${size}` : ''}
          </span>
          {actions(entry.batch, entry.result)}
          {entries.length > 1 && (
            <>
              <Button className="icon-button" type="button" aria-label="上一张" onClick={() => go(-1)}>
                <ChevronLeft size={18} />
              </Button>
              <Button className="icon-button" type="button" aria-label="下一张" onClick={() => go(1)}>
                <ChevronRight size={18} />
              </Button>
            </>
          )}
          <Button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
      </div>
    </div>
  );
}
