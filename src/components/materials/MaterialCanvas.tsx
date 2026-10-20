import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { BookOpen, BookmarkPlus, Check, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Download, ImagePlus, PanelLeftClose, PanelLeftOpen, Pencil, Play, RotateCcw, Save, Search, Settings, Sparkles, Trash2, TriangleAlert, Wand2, X } from 'lucide-react';
import { Button } from '../ui/button';
import type { MaterialLibraryController } from '../../materials/useMaterialLibrary';
import {
  loadCanvasDetailWidth,
  loadCanvasPanelCollapsed,
  loadCanvasRecordView,
  loadCanvasSortOrder,
  saveCanvasDetailWidth,
  saveCanvasPanelCollapsed,
  saveCanvasRecordView,
  saveCanvasSortOrder,
  type CanvasRecordView,
  type CanvasSortOrder,
} from '../../localState';
import { copyToClipboard } from '../../promptUtils';
import { useDetailResize } from '../../useDetailResize';
import type { PromptItem } from '../../types';
import { canvas, getCanvasState, isActive, isVideoModel, savedInHistory, useCanvasState, visibleTasks, type CanvasReference } from '../../materials/canvasStore';
import {
  canvasAspectRatioOptions,
  extractPromptKeywords,
  getCanvasGenerationSizeLabel,
  maxCanvasPromptLength,
  resolveCanvasGenerationSize,
} from '../../materials/suyan/canvasGeneration.ts';
import type { CanvasBaseResolution, CanvasReferenceImage, CanvasSizeMode } from '../../materials/suyan/canvasTypes.ts';
import { ReferenceEditor, ReferencePreview, type EditorMode } from './ReferenceEditor';

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
// 生成记录每次多显示这么多个任务，历史多了也不卡。
const PAGE_SIZE = 20;
const RECORD_VIEWS: Array<{ value: CanvasRecordView; label: string }> = [
  { value: 'tasks', label: '列表' },
  { value: 'wall', label: '网格' },
];
const SORT_ORDERS: Array<{ value: CanvasSortOrder; label: string }> = [
  { value: 'newest', label: '最新优先' },
  { value: 'oldest', label: '最早优先' },
];

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
  onOpenSettings: () => void;
  templates: PromptItem[];
  templateCategories: string[];
  onSaveTemplate: (content: string) => void;
};

export function MaterialCanvas({ controller, onOpenSettings, templates, templateCategories, onSaveTemplate }: MaterialCanvasProps) {
  const { draft, error, queue, history, historyLoaded } = useCanvasState();
  const [model, setModel] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [recordView, setRecordView] = useState(loadCanvasRecordView);
  const [sortOrder, setSortOrder] = useState(loadCanvasSortOrder);
  const { width: detailWidth, resizerProps } = useDetailResize(loadCanvasDetailWidth, saveCanvasDetailWidth);
  const [panelCollapsed, setPanelCollapsed] = useState(loadCanvasPanelCollapsed);
  // 右侧详情栏显示的记录：`任务 id:图序号`，没有图的任务是 `任务 id:`；没选过或选的不见了就显示第一条。
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // 参考图拖动排序：正在拖的是第几张、要放到第几张的位置。
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // 参考图全图预览（第几张），和正在中间区域编辑的那张（编辑时生成记录先让位）。
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ reference: CanvasReference; mode: EditorMode; opened: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const finishedSlots = useRef(-1);
  const busy = Boolean(controller.busy);
  const video = Boolean(model && isVideoModel(model));
  const sizeLabel = getCanvasGenerationSizeLabel(resolveCanvasGenerationSize(draft));
  const tasks = useMemo(() => visibleTasks(queue, history, query, sortOrder), [queue, history, query, sortOrder]);
  const queueIds = useMemo(() => new Set(queue.map((task) => task.id)), [queue]);
  const totalCount = useMemo(() => queue.length + history.filter((task) => !queueIds.has(task.id)).length, [queue, history, queueIds]);
  const activeCount = queue.filter(isActive).length;

  // 去设置页改完回来时画布会重新挂载，再读一次生图模型。
  useEffect(() => {
    void controller
      .aiGetSettings()
      .then((settings) => setModel(settings.image?.usable ? settings.image.model : ''))
      .catch(() => setModel(''));
  }, []);

  const reloadHistory = () =>
    controller
      .canvasHistory()
      .then(({ history: loaded, dropped }) => {
        canvas.setHistory(loaded.tasks);
        if (dropped) canvas.showError(`生成历史里有 ${dropped} 条记录读不懂（可能是别的电脑上更新的版本写的），已跳过；下次生成时它们不会被保留`);
      })
      .catch((loadError) => {
        // 读不到（比如 NAS 暂时连不上）时保留已有的，界面不卡在「正在读取」。
        console.warn('读取生成历史失败', loadError);
        canvas.setHistory(getCanvasState().history);
      });

  // 打开画布时取一次队列和历史（别的电脑可能生成过），之后跟着主进程推来的队列变化走；有槽位结束就重读历史。
  useEffect(() => {
    void controller.canvasQueue().then(canvas.setQueue);
    void reloadHistory();
    return controller.onCanvasQueue((tasks) => {
      canvas.setQueue(tasks);
      const finished = tasks.reduce((sum, task) => sum + task.slots.filter((slot) => slot.status === 'done' || slot.status === 'failed').length, 0);
      if (finishedSlots.current >= 0 && finished > finishedSlots.current) void reloadHistory();
      finishedSlots.current = finished;
    });
  }, []);

  // 画布里按 Ctrl+V：剪贴板里有图就加成参考图；输入框里的粘贴照常。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') || viewing) return;
      if (!event.clipboardData?.types.some((type) => type.startsWith('image/') || type === 'Files')) return;
      event.preventDefault();
      // 在资源管理器里复制的图片文件只在 clipboardData.files 里，主进程 readImage 读不到，所以先用这里的文件。
      const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
      if (images.length) void addReferenceFiles(images);
      else void pasteReference();
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [viewing]);

  const pasteReference = async () => {
    const dataUrl = await controller.canvasClipboardImage();
    if (dataUrl) canvas.addReferences([{ fileName: '', title: '剪贴板图片', dataUrl }]);
  };

  const addReferenceFiles = async (files: File[]) =>
    canvas.addReferences(await Promise.all(files.map(async (file) => ({ fileName: '', title: file.name, dataUrl: await readAsDataUrl(file) }))));

  const pickReferences = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    await addReferenceFiles(files);
  };

  const optimize = async (key: 'prompt' | 'negativePrompt') => {
    const optimized = await controller.aiOptimize(draft[key], key === 'prompt' ? 'positive' : 'negative');
    if (optimized) canvas.setDraft({ [key]: optimized });
  };

  // 提交后立刻可以改参数再提交，任务在主进程队列里排队。
  // 提交成功后详情栏立刻换成新任务、按钮短暂显示「已提交」：选「最早优先」或记录很多时新任务在列表最后、不在当前页，
  // 不这样看起来像点了没反应（1.9.0 主人 17 秒连点了 27 次，每次其实都提交了）。
  const [justSubmitted, setJustSubmitted] = useState(false);
  const generate = async () => {
    if (!model || submitting) return;
    setSubmitting(true);
    let taskId = '';
    const submitted = await canvas.submit(model, async (input) => (taskId = await controller.canvasSubmit(input)));
    setSubmitting(false);
    if (!submitted || !taskId) return;
    setSelectedKey(`${taskId}:0`);
    setJustSubmitted(true);
    window.setTimeout(() => setJustSubmitted(false), 1500);
  };

  // 本次打开画布后存过的：没存进生成历史、只在内存里的图没有历史标记可读，靠这里记住，按钮才会变成「已存入」。
  const [savedNow, setSavedNow] = useState<ReadonlySet<string>>(new Set());
  const save = async (task: MaterialCanvasTask, slot: MaterialCanvasSlot) => {
    if (!(await controller.canvasSave(task.id, slot.index))) return;
    setSavedNow((keys) => new Set(keys).add(`${task.id}:${slot.index}`));
    void reloadHistory();
  };

  // 回填前把收起的参数栏展开，不然看不到恢复了什么。
  const showPanel = () => {
    if (!panelCollapsed) return;
    setPanelCollapsed(false);
    saveCanvasPanelCollapsed(false);
  };

  // 全量恢复：提示词、参数，以及存在生成历史里的参考图（1.8.6 起才存，更早的任务只能恢复提示词和参数）。
  const restoreFull = async (task: MaterialCanvasTask) => {
    const stored = history.find((entry) => entry.id === task.id)?.references ?? task.references ?? [];
    const references: CanvasReferenceImage[] = [];
    for (const [index, media] of stored.entries()) {
      const dataUrl = await controller.canvasHistoryImage(media);
      if (!dataUrl) return '当时的参考图读不出来，这次没有恢复，可以稍后再试';
      references.push({ fileName: '', title: `当时的参考图 ${index + 1}`, dataUrl });
    }
    canvas.restoreTask(task, references);
    showPanel();
    const missing = task.referenceCount - references.length;
    if (missing > 0) return `已恢复提示词和参数。当时的 ${missing} 张参考图没有保存（1.8.6 以前生成的任务不存参考图），需要重新添加。`;
    return references.length ? `已恢复提示词、参数和 ${references.length} 张参考图。` : '已恢复提示词和参数。';
  };

  // 仅回填参考图：把这张生成的图加到参考图末尾，提示词和参数不动。
  const backfillReference = async (task: MaterialCanvasTask, slot: MaterialCanvasSlot) => {
    const dataUrl = slot.dataUrl ?? (slot.media ? await controller.canvasHistoryImage(slot.media) : null);
    if (!dataUrl) return '';
    canvas.addReferences([{ fileName: '', title: `生成的图 ${formatTime(task.createdAt)}`, dataUrl }]);
    showPanel();
    return `已加到参考图（现在共 ${getCanvasState().draft.referenceImages.length} 张）。`;
  };

  const editReference = (index: number) => {
    const reference: CanvasReference = draft.referenceImages[index];
    setPreviewIndex(null);
    setEditing({ reference, mode: reference.maskDataUrl ? 'mask' : 'crop', opened: Date.now() });
  };

  const saveEditedReference = (next: CanvasReference) => {
    if (editing && !canvas.replaceReference(editing.reference, next)) canvas.showError('编辑期间这张参考图被移除了，编辑结果没有保存');
    setEditing(null);
  };

  const removeTask = async (task: MaterialCanvasTask) => {
    const remaining = await controller.canvasHistoryDelete([task.id]);
    if (remaining) canvas.setHistory(remaining.tasks);
  };

  const viewerEntries = tasks.flatMap((task) => task.slots.filter((slot) => slot.status === 'done').map((slot) => ({ task, slot })));
  const slotSaved = (task: MaterialCanvasTask, slot: MaterialCanvasSlot) =>
    Boolean(slot.savedToLibrary) || savedNow.has(`${task.id}:${slot.index}`) || savedInHistory(history, task.id, slot.index);
  const resultActions = (task: MaterialCanvasTask, slot: MaterialCanvasSlot) => {
    const saved = slotSaved(task, slot);
    return (
      <div className="canvas-result-actions">
        <Button className="button ghost compact" type="button" disabled={busy || saved} onClick={() => void save(task, slot)}>
          {saved ? <Check size={13} /> : <Save size={13} />}
          {saved ? '已存入' : '存入素材库'}
        </Button>
        <Button className="button ghost compact" type="button" disabled={busy} onClick={() => void controller.canvasSaveAs(task.id, slot.index)}>
          <Download size={13} />
          另存为
        </Button>
        {/* 原提示词在任务头部就能复用；模型改写过提示词时，这里复用改写后的。 */}
        {slot.revisedPrompt && (
          <Button className="button ghost compact" type="button" title="把模型改写后的提示词放回左边" onClick={() => canvas.reusePrompt(task, slot)}>
            <RotateCcw size={13} />
            复用改写后的提示词
          </Button>
        )}
      </div>
    );
  };

  const changeRecordView = (view: CanvasRecordView) => {
    setRecordView(view);
    saveCanvasRecordView(view);
  };
  const changeSortOrder = (order: CanvasSortOrder) => {
    setSortOrder(order);
    saveCanvasSortOrder(order);
  };
  const togglePanel = () => {
    setPanelCollapsed(!panelCollapsed);
    saveCanvasPanelCollapsed(!panelCollapsed);
  };

  const pageTasks = tasks.slice(0, shown);
  const selected = useMemo(() => {
    const split = selectedKey?.indexOf(':') ?? -1;
    const task = split > 0 ? tasks.find((entry) => entry.id === selectedKey!.slice(0, split)) : undefined;
    if (task) {
      const index = selectedKey!.slice(split + 1);
      return { task, slot: index === '' ? null : (task.slots.find((slot) => slot.index === Number(index)) ?? null) };
    }
    return pageTasks[0] ? { task: pageTasks[0], slot: preferredSlot(pageTasks[0]) } : null;
  }, [selectedKey, tasks, pageTasks]);
  const currentKey = selected ? slotKey(selected.task, selected.slot) : null;
  const imageCount = tasks.reduce((sum, task) => sum + task.slots.filter((slot) => slot.status === 'done').length, 0);
  const countLine = [
    query.trim() ? `找到 ${tasks.length} 个任务（共 ${totalCount} 个）` : `共 ${tasks.length} 个任务 · ${imageCount} 张图`,
    activeCount ? `${activeCount} 个进行中` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const renderRow = (task: MaterialCanvasTask) => (
    <CanvasTaskRow key={task.id} task={task} inQueue={queueIds.has(task.id)} currentKey={currentKey} isSaved={slotSaved} onSelect={setSelectedKey} />
  );

  return (
    <div className={`canvas-layout ${panelCollapsed ? 'is-panel-collapsed' : ''}`} style={{ '--canvas-detail-width': `${detailWidth}px` } as CSSProperties}>
      {panelCollapsed ? (
        <aside className="canvas-panel-rail" aria-label="生成参数（已收起）">
          <Button className="icon-button" type="button" aria-label="展开生成参数" title="展开生成参数" onClick={togglePanel}>
            <PanelLeftOpen size={18} />
          </Button>
          <span>生成参数</span>
        </aside>
      ) : (
      <form
        className="canvas-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void generate();
        }}
      >
        <div className="canvas-panel-head">
          <strong>生成参数</strong>
          <Button className="icon-button" type="button" aria-label="收起生成参数" title="收起生成参数，生成记录更宽" onClick={togglePanel}>
            <PanelLeftClose size={17} />
          </Button>
        </div>
        <label className="field" htmlFor="canvas-prompt">
          <span className="material-field-label">
            正向提示词
            <span className="material-field-tools">
              <Button className="button ghost compact" type="button" aria-expanded={templatesOpen} title="从提示词库选一条填进来" onClick={() => setTemplatesOpen(!templatesOpen)}>
                <BookOpen size={13} />
                模板
              </Button>
              <Button
                className="icon-button compact-icon"
                type="button"
                aria-label="存为模板"
                title="把当前提示词存进提示词库的「画布模板」分类"
                disabled={!draft.prompt.trim()}
                onClick={() => onSaveTemplate(draft.prompt)}
              >
                <BookmarkPlus size={14} />
              </Button>
              <Button className="button ghost compact" type="button" disabled={busy || !draft.prompt.trim()} onClick={() => void optimize('prompt')}>
                <Wand2 size={13} />
                优化
              </Button>
              <Button className="button ghost compact" type="button" disabled={!draft.prompt} onClick={() => canvas.setDraft({ prompt: '' })}>
                清空
              </Button>
            </span>
          </span>
          {templatesOpen && (
            <TemplatePicker
              templates={templates}
              categories={templateCategories}
              onPick={(content) => {
                canvas.setDraft({ prompt: content.slice(0, maxCanvasPromptLength) });
                setTemplatesOpen(false);
              }}
              onClose={() => setTemplatesOpen(false)}
            />
          )}
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
              {draft.referenceImages.length > 0 && (
                <Button className="button ghost compact" type="button" title="移除全部参考图" onClick={() => canvas.clearReferences()}>
                  清空
                </Button>
              )}
            </span>
          </span>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => void pickReferences(event)} />
          {draft.referenceImages.length > 0 ? (
            <>
              {/* 顺序就是提交顺序：拖动换位置，或者选中后按左右方向键 */}
              <div className="canvas-references" role="list" aria-label="参考图，拖动或按左右方向键调整顺序">
                {draft.referenceImages.map((reference, index) => (
                  <div
                    key={index}
                    role="listitem"
                    tabIndex={0}
                    draggable
                    className={`canvas-reference ${dragIndex === index ? 'is-dragging' : ''} ${dropIndex === index && dragIndex !== null && dragIndex !== index ? 'is-drop-target' : ''}`}
                    title={`第 ${index + 1} 张：${reference.title}`}
                    aria-label={`第 ${index + 1} 张参考图 ${reference.title}`}
                    onDragStart={(event) => {
                      setDragIndex(index);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', String(index));
                    }}
                    onDragOver={(event) => {
                      if (dragIndex === null) return;
                      event.preventDefault();
                      setDropIndex(index);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragIndex !== null) canvas.moveReference(dragIndex, index);
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    onClick={(event) => {
                      if (!(event.target as HTMLElement).closest('button')) setPreviewIndex(index);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && event.target === event.currentTarget) {
                        setPreviewIndex(index);
                        return;
                      }
                      const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                      if (!step || event.target !== event.currentTarget) return;
                      event.preventDefault();
                      canvas.moveReference(index, index + step);
                      // 按位置渲染（key 是序号），焦点跟到图移过去的那个位置
                      (event.currentTarget.parentElement?.children[index + step] as HTMLElement | undefined)?.focus();
                    }}
                  >
                    <img src={reference.dataUrl} alt="" draggable={false} />
                    <span className="canvas-reference-order" aria-hidden="true">
                      {index + 1}
                    </span>
                    {(reference as CanvasReference).maskDataUrl && (
                      <span className="canvas-reference-mask" title="已涂遮罩（局部重绘）">
                        遮罩
                      </span>
                    )}
                    <button type="button" aria-label={`移除参考图 ${reference.title}`} onClick={() => canvas.removeReference(index)}>
                      <X size={12} />
                    </button>
                    <button type="button" className="canvas-reference-edit" aria-label={`编辑参考图 ${reference.title}`} title="编辑：裁剪、透视裁剪、局部重绘" onClick={() => editReference(index)}>
                      <Pencil size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="nas-form-note">点图看大图，右下角铅笔可以裁剪、透视裁剪、局部重绘。{draft.referenceImages.length > 1 ? '按顺序提交，拖动可以调整先后。' : ''}</p>
            </>
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
            // 放进 .field 才有和其它输入框一样的边框和字号。
            <div className="field">
              <textarea aria-label="负向提示词" value={draft.negativePrompt} maxLength={maxCanvasPromptLength} rows={3} onChange={(event) => canvas.setDraft({ negativePrompt: event.target.value })} placeholder="不想出现的内容" />
            </div>
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
            model && <ModelPicker controller={controller} model={model} video={video} onChange={setModel} />
          )}
          {error && (
            <p className="canvas-error" role="alert">
              {error}
              <button type="button" aria-label="关闭错误提示" onClick={() => canvas.clearError()}>
                <X size={12} />
              </button>
            </p>
          )}
          <Button className="button primary canvas-generate" type="submit" disabled={submitting || !model || !draft.prompt.trim()}>
            {justSubmitted ? <Check size={15} /> : <Sparkles size={15} />}
            {justSubmitted ? '已提交，右边是这个任务' : video ? '生成视频' : activeCount ? '再提交一个任务' : '生成'}
          </Button>
        </div>
      </form>
      )}

      <section className="canvas-stage" aria-label={editing ? '编辑参考图' : '生成记录'}>
        {editing ? (
          <ReferenceEditor
            key={editing.opened}
            reference={editing.reference}
            position={draft.referenceImages.indexOf(editing.reference) + 1}
            initialMode={editing.mode}
            onSave={saveEditedReference}
            onCancel={() => setEditing(null)}
          />
        ) : (
        <>
        <div className="canvas-stage-header">
          <div className="canvas-stage-title">
            <strong>生成记录</strong>
            {/* 页面标题栏去掉后，存入、读取这类进度显示在这里 */}
            <span aria-live="polite">{controller.busy || (historyLoaded || tasks.length ? countLine : '正在读取生成历史…')}</span>
          </div>
          <div className="canvas-stage-tools">
            <Segmented value={recordView} options={RECORD_VIEWS} onChange={changeRecordView} label="生成记录的看法" />
            <Segmented value={sortOrder} options={SORT_ORDERS} onChange={changeSortOrder} label="生成记录的排序" />
            <label className="materials-search canvas-search">
              <Search size={15} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词、模型" aria-label="搜索生成记录" />
            </label>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="canvas-empty">
            <Sparkles size={22} aria-hidden="true" />
            <strong>{query ? '没有匹配的记录' : historyLoaded ? '写好提示词，点生成' : '正在读取生成历史…'}</strong>
            {!query && historyLoaded && <span>可以连续提交多个任务，它们会排队生成；生成的图自动存进 NAS 的生成历史，满意的再存入素材库。</span>}
          </div>
        ) : (
          <>
            {recordView === 'tasks' ? (
              pageTasks.map(renderRow)
            ) : (
              <>
                {/* 进行中的任务照常按列表显示，看得到每张的进度；生成好的图平铺成网格。 */}
                {pageTasks.filter(isActive).map(renderRow)}
                <CanvasGrid tasks={pageTasks.filter((task) => !isActive(task))} newIds={queueIds} currentKey={currentKey} isSaved={slotSaved} onSelect={setSelectedKey} />
              </>
            )}
            {tasks.length > shown && (
              <Button className="button ghost canvas-more" type="button" onClick={() => setShown(shown + PAGE_SIZE)}>
                再显示 {Math.min(PAGE_SIZE, tasks.length - shown)} 个（共 {tasks.length} 个）
              </Button>
            )}
          </>
        )}
        </>
        )}
      </section>

      <aside className="canvas-detail" aria-label="记录详情">
        <Button
          className="canvas-detail-resizer"
          type="button"
          aria-label="拖动调整详情栏宽度"
          title="拖动调整详情栏宽度（也可以用左右方向键）"
          {...resizerProps}
        />
        {selected ? (
          <CanvasDetail
            key={selected.task.id}
            task={selected.task}
            slot={selected.slot}
            inQueue={queueIds.has(selected.task.id)}
            busy={busy}
            isSaved={slotSaved}
            onSelect={setSelectedKey}
            onOpen={(slot) => setViewing(slotKey(selected.task, slot))}
            onRestore={() => restoreFull(selected.task)}
            onBackfill={(slot) => backfillReference(selected.task, slot)}
            onCancel={() => void controller.canvasCancel(selected.task.id)}
            onRetry={(slot) => void controller.canvasRetry(selected.task.id, slot.index)}
            onDelete={() => void removeTask(selected.task)}
            actions={resultActions}
          />
        ) : (
          <p className="canvas-detail-empty">{historyLoaded ? '生成的记录会显示在这里，点一条看完整提示词和参数。' : '正在读取生成历史…'}</p>
        )}
      </aside>

      {previewIndex !== null && (
        <ReferencePreview references={draft.referenceImages} index={previewIndex} onChange={setPreviewIndex} onEdit={editReference} onClose={() => setPreviewIndex(null)} />
      )}

      {viewing && (
        <CanvasViewer
          entries={viewerEntries}
          currentId={viewing}
          onChange={(key) => {
            setViewing(key);
            setSelectedKey(key);
          }}
          onClose={() => setViewing(null)}
          onReuse={(task) => {
            void restoreFull(task);
            setViewing(null);
          }}
          actions={resultActions}
        />
      )}
    </div>
  );
}

const STATUS_LABELS: Record<MaterialCanvasSlot['status'], string> = { queued: '排队中', running: '生成中', done: '', failed: '失败', canceled: '已取消' };

// 生成好的图：生成历史里的走 nas-media://canvas-history/…；没存进历史的用内存里的 data URL。
const slotSrc = (slot: MaterialCanvasSlot, full = false) => {
  if (slot.media) {
    const { sha256, ext, hasThumb } = slot.media;
    return !full && hasThumb ? `nas-media://canvas-history/thumbs/${sha256}.jpg` : `nas-media://canvas-history/media/${sha256}${ext}`;
  }
  return slot.dataUrl ?? '';
};

const isVideoSlot = (slot: MaterialCanvasSlot) => slot.media?.kind === 'video' || Boolean(slot.dataUrl?.startsWith('data:video/'));

const slotKey = (task: MaterialCanvasTask, slot: MaterialCanvasSlot | null) => `${task.id}:${slot ? slot.index : ''}`;
// 选中一个任务时默认看哪张：第一张生成好的，没有就看第一个槽位（失败原因、进度）。
const preferredSlot = (task: MaterialCanvasTask) => task.slots.find((slot) => slot.status === 'done') ?? task.slots[0] ?? null;
const mediaRatio = (slot: MaterialCanvasSlot) => (slot.media?.width && slot.media.height ? slot.media.width / slot.media.height : null);
const formatTime = (iso: string, withYear = false) =>
  new Date(iso).toLocaleString('zh-CN', { ...(withYear ? { year: 'numeric' } : {}), month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const sizeText = (task: MaterialCanvasTask) => (task.params.size && task.params.size !== 'auto' ? task.params.size.replace('x', '×') : '自动尺寸');
const QUALITY_LABELS: Record<string, string> = { auto: '自动', low: '低', medium: '中', high: '高' };

// 选的尺寸对应的宽高比：生成中的占位块按这个比例画，等图出来时不跳。auto 时按方形。
const targetRatio = (task: MaterialCanvasTask) => {
  const [, width, height] = task.params.size.match(/^(\d+)x(\d+)$/) ?? [];
  if (width) return Number(width) / Number(height);
  const [, ratioWidth, ratioHeight] = task.params.ratio.match(/^(\d+):(\d+)$/) ?? [];
  return ratioWidth ? Number(ratioWidth) / Number(ratioHeight) : 1;
};

// 每秒走一次的时钟，只在有东西在生成时开着。
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function Elapsed({ startedAt }: { startedAt: string | null | undefined }) {
  const now = useNow(Boolean(startedAt));
  if (!startedAt) return null;
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return (
    <span className="canvas-elapsed">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

// 缩略图按原图比例完整显示（object-fit: contain），不裁边。比例先用历史里记的宽高，避免加载时跳动；内存里的图没记宽高，加载后再按实际比例排。
// 从 NAS 读完之前显示骨架闪光；读不到（丢了、NAS 暂时连不上）先换原图，原图也读不到就写明，不留破图标。
function SlotThumb({ slot, isNew, selected, label, onClick }: { slot: MaterialCanvasSlot; isNew: boolean; selected: boolean; label: string; onClick: () => void }) {
  const video = isVideoSlot(slot);
  const [full, setFull] = useState(false);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [natural, setNatural] = useState<number | null>(null);
  const ratio = mediaRatio(slot) ?? natural;
  return (
    <button
      type="button"
      className={`canvas-result-media ${isNew ? 'is-new' : ''} ${selected ? 'is-selected' : ''} ${loaded || broken ? '' : 'is-loading'}`}
      style={ratio ? ({ '--media-ratio': ratio } as CSSProperties) : undefined}
      aria-label={label}
      aria-pressed={selected}
      aria-busy={!loaded && !broken}
      onClick={onClick}
    >
      {broken ? (
        <span className="canvas-media-missing">读不到这张图</span>
      ) : video && !slot.media?.hasThumb ? (
        <video src={slotSrc(slot, true)} muted playsInline preload="metadata" onLoadedData={() => setLoaded(true)} onError={() => setBroken(true)} />
      ) : (
        <img
          src={slotSrc(slot, full)}
          alt=""
          loading="lazy"
          onLoad={(event) => {
            setLoaded(true);
            if (event.currentTarget.naturalHeight) setNatural(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight);
          }}
          onError={() => (full || !slot.media?.hasThumb ? setBroken(true) : setFull(true))}
        />
      )}
      {video && (
        <span className="canvas-play-badge" aria-hidden="true">
          <Play size={14} />
        </span>
      )}
    </button>
  );
}

type RecordProps = {
  currentKey: string | null;
  isSaved: (task: MaterialCanvasTask, slot: MaterialCanvasSlot) => boolean;
  onSelect: (key: string) => void;
};

// 网格：已结束任务里生成好的图按排序平铺，每格正方形，图按原比例完整放在格子里。失败、取消的不上网格，在「列表」里看。
function CanvasGrid({ tasks, newIds, currentKey, isSaved, onSelect }: RecordProps & { tasks: MaterialCanvasTask[]; newIds: ReadonlySet<string> }) {
  const entries = tasks.flatMap((task) => task.slots.filter((slot) => slot.status === 'done').map((slot) => ({ task, slot })));
  const notShown = tasks.reduce((sum, task) => sum + task.slots.filter((slot) => slot.status !== 'done').length, 0);
  return (
    <>
      {entries.length > 0 ? (
        <div className="canvas-wall">
          {entries.map(({ task, slot }) => {
            const key = slotKey(task, slot);
            return (
              <figure key={key} className={`canvas-wall-item ${key === currentKey ? 'is-selected' : ''}`}>
                <SlotThumb slot={slot} isNew={newIds.has(task.id)} selected={key === currentKey} label={`查看详情：${task.prompt.slice(0, 40)}`} onClick={() => onSelect(key)} />
                {isSaved(task, slot) && (
                  <span className="canvas-saved-badge" title="已存入素材库">
                    <Check size={12} />
                  </span>
                )}
                {slot.error && (
                  <span className="canvas-warning-badge" role="img" aria-label={slot.error} title={slot.error}>
                    <TriangleAlert size={12} />
                  </span>
                )}
                <figcaption className="canvas-wall-caption">
                  <span>{slot.media?.width && slot.media.height ? `${slot.media.width}×${slot.media.height}` : sizeText(task)}</span>
                  <span>{formatTime(task.createdAt)}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : (
        tasks.length > 0 && <p className="canvas-wall-note">这些任务里没有生成好的图。</p>
      )}
      {notShown > 0 && <p className="canvas-wall-note">另有 {notShown} 张失败或取消的没放进网格，切到「列表」查看。</p>}
    </>
  );
}

// 列表的一行：左边时间、模型、尺寸和三行提示词（双击展开全文），右边按原比例的缩略图。
// 生成中、排队、失败的槽位只画一个按目标比例的占位块和一句状态，原因、进度、重试都在右侧详情栏，不重复堆在这里。
function CanvasTaskRow({ task, inQueue, currentKey, isSaved, onSelect }: RecordProps & { task: MaterialCanvasTask; inQueue: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const active = isActive(task);
  // 历史里没记录的槽位（取消了的，或别的电脑上还没结束的）补成占位，保证张数对得上。
  const slots = Array.from({ length: task.total }, (_, index) => task.slots.find((slot) => slot.index === index) ?? null);
  const selectedTask = currentKey?.startsWith(`${task.id}:`) ?? false;
  const ratio = targetRatio(task);

  return (
    <article className={`canvas-task ${active ? 'is-active' : ''} ${selectedTask ? 'is-selected' : ''}`}>
      <button type="button" className="canvas-task-info" aria-pressed={selectedTask} onClick={() => onSelect(slotKey(task, preferredSlot(task)))}>
        <span className="canvas-task-meta">
          {formatTime(task.createdAt)} · {task.model} · {sizeText(task)}
          {task.referenceCount ? ` · ${task.referenceCount} 张参考图` : ''}
        </span>
        <span
          className={`canvas-task-prompt ${expanded ? 'is-expanded' : ''}`}
          title={expanded ? '双击收起' : '双击展开全文'}
          onMouseDown={(event) => {
            // 双击时不选中文字
            if (event.detail > 1) event.preventDefault();
          }}
          onDoubleClick={() => setExpanded(!expanded)}
        >
          {task.prompt}
        </span>
      </button>
      <div className="canvas-task-slots">
        {slots.map((slot, index) => {
          const key = slot ? slotKey(task, slot) : '';
          const status = slot?.status ?? (active ? 'queued' : 'missing');
          return (
            <figure key={index} className={`canvas-slot is-${status}`}>
              {slot?.status === 'done' ? (
                <>
                  <SlotThumb slot={slot} isNew={inQueue} selected={key === currentKey} label={`查看第 ${index + 1} 张的详情`} onClick={() => onSelect(key)} />
                  {isSaved(task, slot) && (
                    <span className="canvas-saved-badge" title="已存入素材库">
                      <Check size={12} />
                    </span>
                  )}
                  {slot.error && (
                    <span className="canvas-warning-badge" role="img" aria-label={slot.error} title={slot.error}>
                      <TriangleAlert size={12} />
                    </span>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className={`canvas-slot-placeholder ${key && key === currentKey ? 'is-selected' : ''}`}
                  style={{ '--media-ratio': ratio } as CSSProperties}
                  aria-label={`第 ${index + 1} 张：${slot ? STATUS_LABELS[slot.status] : active ? '排队中' : '没有结果'}，查看详情`}
                  onClick={() => onSelect(slot ? key : slotKey(task, null))}
                >
                  {status === 'running' && <span className="canvas-skeleton" aria-hidden="true" />}
                  <span className="canvas-slot-state">
                    {status === 'running' ? (
                      <>
                        生成中 <Elapsed startedAt={slot?.startedAt} />
                      </>
                    ) : status === 'failed' ? (
                      <>
                        <TriangleAlert size={13} aria-hidden="true" />
                        失败
                      </>
                    ) : slot ? (
                      STATUS_LABELS[slot.status]
                    ) : active ? (
                      '排队中'
                    ) : (
                      '没有结果'
                    )}
                  </span>
                </button>
              )}
            </figure>
          );
        })}
      </div>
    </article>
  );
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      className="button ghost compact"
      type="button"
      onClick={() =>
        void copyToClipboard(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        )
      }
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? '已复制' : label}
    </Button>
  );
}

// 详情栏里的长提示词默认收成 6 行，真的被截断时才出现「展开全文」；双击文字也能展开、收起。
function CollapsibleText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && !expanded) setOverflowing(element.scrollHeight > element.clientHeight + 1);
  }, [text, expanded]);
  const toggle = () => setExpanded(!expanded);
  return (
    <>
      <p
        ref={ref}
        className={`canvas-detail-text ${expanded ? 'is-expanded' : ''}`}
        title={overflowing && !expanded ? '双击展开全文' : undefined}
        onMouseDown={(event) => {
          if (event.detail > 1 && (overflowing || expanded)) event.preventDefault();
        }}
        onDoubleClick={() => (overflowing || expanded) && toggle()}
      >
        {text}
      </p>
      {(overflowing || expanded) && (
        <button type="button" className="canvas-text-toggle" aria-expanded={expanded} onClick={toggle}>
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </>
  );
}

type CanvasDetailProps = {
  task: MaterialCanvasTask;
  slot: MaterialCanvasSlot | null;
  inQueue: boolean;
  busy: boolean;
  isSaved: (task: MaterialCanvasTask, slot: MaterialCanvasSlot) => boolean;
  onSelect: (key: string) => void;
  onOpen: (slot: MaterialCanvasSlot) => void;
  // 两种回填：全量恢复（提示词 + 参数 + 当时的参考图），仅回填参考图（把这张生成的图加成参考图）。返回给用户看的结果说明。
  onRestore: () => Promise<string>;
  onBackfill: (slot: MaterialCanvasSlot) => Promise<string>;
  onCancel: () => void;
  onRetry: (slot: MaterialCanvasSlot) => void;
  onDelete: () => void;
  actions: (task: MaterialCanvasTask, slot: MaterialCanvasSlot) => React.ReactNode;
};

// 右侧详情栏：大图、同一任务的其他图、参数、完整提示词和全部操作。点大图进全屏。
function CanvasDetail({ task, slot, inQueue, busy, isSaved, onSelect, onOpen, onRestore, onBackfill, onCancel, onRetry, onDelete, actions }: CanvasDetailProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ key: string; size: string; ratio: number } | null>(null);
  const [note, setNote] = useState('');
  const active = isActive(task);
  const keywords = useMemo(() => extractPromptKeywords(task.prompt, 3), [task.prompt]);
  const key = slotKey(task, slot);
  const done = task.slots.filter((entry) => entry.status === 'done').length;
  const actual = slot?.media?.width && slot.media.height ? `${slot.media.width}×${slot.media.height}` : natural?.key === key ? natural.size : '';
  const ratio = (slot && mediaRatio(slot)) ?? (natural?.key === key ? natural.ratio : null) ?? targetRatio(task);
  const status = active ? (task.slots.some((entry) => entry.status === 'running') ? '生成中' : '排队中') : `${done}/${task.total} 张生成好`;
  const rows: Array<[string, string]> = [
    ['时间', formatTime(task.createdAt, true)],
    ['状态', status],
    ['模型', task.model],
    ['尺寸', actual ? `选 ${sizeText(task)} · 实际 ${actual}` : sizeText(task)],
    ['比例', task.params.ratio],
    ['质量', QUALITY_LABELS[task.params.quality] ?? task.params.quality],
    ['格式', task.params.outputFormat.toUpperCase()],
    ['参考图', task.referenceCount ? `${task.referenceCount} 张` : ''],
  ];
  const slots = Array.from({ length: task.total }, (_, index) => task.slots.find((entry) => entry.index === index) ?? null);
  const mediaStyle = { '--media-ratio': ratio } as CSSProperties;
  const run = (action: () => Promise<string>) => void action().then((message) => message && setNote(message));

  return (
    <div className="canvas-detail-body">
      {slot?.status === 'done' ? (
        broken === key ? (
          <p className="canvas-media-missing canvas-detail-media" style={mediaStyle}>
            读不到这张图：文件可能被删了，或者 NAS 暂时连不上
          </p>
        ) : isVideoSlot(slot) ? (
          <video key={key} className="canvas-detail-media" style={mediaStyle} src={slotSrc(slot, true)} controls playsInline onError={() => setBroken(key)} />
        ) : (
          // 先垫缩略图（列表里已经读过，几乎立刻出来）加骨架闪光，原图从 NAS 读完再盖上去，不再出现空白灰框。
          <button
            type="button"
            className={`canvas-detail-media ${loaded === key ? '' : 'is-loading'}`}
            style={mediaStyle}
            aria-label="全屏查看"
            aria-busy={loaded !== key}
            title="点开全屏查看，左右方向键翻页"
            onClick={() => onOpen(slot)}
          >
            {loaded !== key && slot.media?.hasThumb && <img className="canvas-detail-thumb" src={slotSrc(slot)} alt="" aria-hidden="true" />}
            <img
              key={key}
              className="canvas-detail-full"
              src={slotSrc(slot, true)}
              alt="生成结果"
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                setLoaded(key);
                if (height) setNatural({ key, size: `${width}×${height}`, ratio: width / height });
              }}
              onError={() => setBroken(key)}
            />
          </button>
        )
      ) : (
        <div className={`canvas-detail-media is-placeholder is-${slot?.status ?? (active ? 'queued' : 'missing')}`} style={mediaStyle}>
          {slot?.status === 'running' ? (
            <>
              <span className="canvas-skeleton" aria-hidden="true" />
              <strong>
                生成中 · 已用 <Elapsed startedAt={slot.startedAt} />
              </strong>
              <span className="canvas-progress" role="progressbar" aria-label="正在生成，进度没法预估">
                <span />
              </span>
              <span className="canvas-detail-attempt">{slot.attempts > 1 ? `第 ${slot.attempts} 次尝试` : '一般要几十秒，取决于模型和尺寸'}</span>
              <span className="canvas-keywords">
                {keywords.map((keyword, position) => (
                  <span key={keyword} style={{ animationDelay: `${position * 0.6}s` }}>
                    {keyword}
                  </span>
                ))}
              </span>
            </>
          ) : (
            <strong>{slot?.status === 'failed' ? '没生成出来' : slot ? STATUS_LABELS[slot.status] || '排队中' : active ? '排队中，等前面的图生成完就开始' : '没有结果'}</strong>
          )}
        </div>
      )}

      {task.total > 1 && (
        <div className="canvas-detail-strip" role="group" aria-label="这个任务的其他图">
          {slots.map((entry, index) =>
            entry?.status === 'done' ? (
              <SlotThumb key={index} slot={entry} isNew={false} selected={slotKey(task, entry) === key} label={`看第 ${index + 1} 张`} onClick={() => onSelect(slotKey(task, entry))} />
            ) : (
              <button
                key={index}
                type="button"
                className={`canvas-detail-strip-empty ${entry && slotKey(task, entry) === key ? 'is-selected' : ''}`}
                disabled={!entry}
                onClick={() => entry && onSelect(slotKey(task, entry))}
              >
                {entry ? STATUS_LABELS[entry.status] : '没有结果'}
              </button>
            ),
          )}
        </div>
      )}

      {slot?.error && <p className={slot.status === 'done' ? 'canvas-slot-warning' : slot.status === 'running' ? 'canvas-detail-note' : 'canvas-detail-error'}>{slot.error}</p>}

      <dl className="canvas-detail-meta">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <section className="canvas-detail-section">
        <header>
          <strong>提示词</strong>
          <CopyButton text={task.prompt} />
        </header>
        <CollapsibleText text={task.prompt} />
      </section>
      {task.negativePrompt && (
        <section className="canvas-detail-section">
          <header>
            <strong>负向提示词</strong>
            <CopyButton text={task.negativePrompt} />
          </header>
          <CollapsibleText text={task.negativePrompt} />
        </section>
      )}
      {slot?.revisedPrompt && (
        <section className="canvas-detail-section">
          <header>
            <strong>模型改写后的提示词</strong>
            <CopyButton text={slot.revisedPrompt} />
          </header>
          <CollapsibleText text={slot.revisedPrompt} />
        </section>
      )}

      <div className="canvas-detail-actions">
        <Button className="button primary compact" type="button" disabled={busy} title="提示词、负向提示词、尺寸、质量、格式、张数和当时的参考图都放回左边" onClick={() => run(onRestore)}>
          <RotateCcw size={13} />
          全量恢复
        </Button>
        {slot?.status === 'done' && !isVideoSlot(slot) && (
          <Button className="button ghost compact" type="button" disabled={busy} title="把这张图加到左边的参考图，接着图生图；提示词和参数不动" onClick={() => run(() => onBackfill(slot))}>
            <ImagePlus size={13} />
            仅回填参考图
          </Button>
        )}
        {slot?.status === 'done' && actions(task, slot)}
        {slot && (slot.status === 'failed' || slot.status === 'canceled') && inQueue && (
          <Button className="button ghost compact" type="button" onClick={() => onRetry(slot)}>
            <RotateCcw size={13} />
            重试这张
          </Button>
        )}
      </div>
      {note && (
        <p className="canvas-detail-note" role="status">
          {note}
        </p>
      )}
      {slot && (slot.status === 'failed' || slot.status === 'canceled') && !inQueue && <p className="canvas-slot-hint">这张没生成出来。要重新生成，点「全量恢复」再生成。</p>}

      <div className="canvas-detail-danger">
        {active ? (
          <Button className="button ghost compact" type="button" title="已经发出的请求停不下来，服务商可能仍会生成并扣费" onClick={onCancel}>
            <X size={13} />
            取消这个任务
          </Button>
        ) : confirmingDelete ? (
          <>
            <span>从 NAS 的生成历史里删掉这个任务的 {task.total} 张图？已存入素材库的不受影响。</span>
            <Button className="button ghost compact" type="button" onClick={() => setConfirmingDelete(false)}>
              不删
            </Button>
            <Button className="button solid-danger compact" type="button" disabled={busy} onClick={onDelete}>
              从 NAS 删除
            </Button>
          </>
        ) : (
          <Button className="button ghost danger compact" type="button" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={13} />
            删除任务
          </Button>
        )}
      </div>
      {slot?.status === 'done' && isSaved(task, slot) && <p className="canvas-detail-note">这张已存入素材库。</p>}
    </div>
  );
}

// 提示词模板：就是提示词库里的提示词（不含文档），按分类筛、按标题和内容搜，点一条填进正向提示词。
function TemplatePicker({ templates, categories, onPick, onClose }: { templates: PromptItem[]; categories: string[]; onPick: (content: string) => void; onClose: () => void }) {
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const used = categories.filter((name) => templates.some((template) => template.category === name));
  const list = templates.filter(
    (template) => (!category || template.category === category) && words.every((word) => `${template.title}\n${template.content}\n${template.tags.join(' ')}`.toLowerCase().includes(word)),
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="canvas-templates" role="dialog" aria-label="从提示词库选模板">
      <div className="canvas-templates-head">
        <label className="materials-search canvas-search">
          <Search size={14} aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词库" aria-label="搜索提示词库" />
        </label>
        <Button className="icon-button compact-icon" type="button" aria-label="关闭模板" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      {used.length > 0 && (
        <div className="canvas-template-chips" role="radiogroup" aria-label="按分类筛">
          {['', ...used].map((name) => (
            <button key={name || '全部'} type="button" role="radio" aria-checked={category === name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>
              {name || '全部'}
            </button>
          ))}
        </div>
      )}
      {list.length > 0 ? (
        <ul className="canvas-template-list">
          {list.slice(0, 200).map((template) => (
            <li key={template.id}>
              <button type="button" title={template.content} onClick={() => onPick(template.content)}>
                <strong>{template.title}</strong>
                <span>{template.content}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nas-form-note">{templates.length ? '没有匹配的提示词。' : '提示词库还是空的。写好提示词后点「存为模板」就会存进去。'}</p>
      )}
    </div>
  );
}

// 生图模型快捷切换：列表用生图位置已保存的地址和 Key 查（只查模型列表，不扣费），换模型只改模型名，完整配置还在设置里。
function ModelPicker({ controller, model, video, onChange }: { controller: MaterialLibraryController; model: string; video: boolean; onChange: (model: string) => void }) {
  const [options, setOptions] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    void controller.aiListImageModels().then((list) => alive && setOptions(list));
    return () => {
      alive = false;
    };
  }, []);
  const list = [model, ...(options ?? []).filter((id) => id !== model)];
  return (
    <label className="canvas-model-picker">
      <span>生图模型{video ? '（生成视频）' : ''}</span>
      <select
        value={model}
        aria-label="生图模型"
        onChange={(event) => void controller.aiSetImageModel(event.target.value).then((saved) => saved && onChange(saved))}
      >
        {list.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
        {options === null && (
          <option disabled value="">
            正在查询可用模型…
          </option>
        )}
        {options?.length === 0 && (
          <option disabled value="">
            没查到别的生图模型（可在设置里查看）
          </option>
        )}
      </select>
    </label>
  );
}

type ViewerEntry = { task: MaterialCanvasTask; slot: MaterialCanvasSlot };

function CanvasViewer({
  entries,
  currentId,
  onChange,
  onClose,
  onReuse,
  actions,
}: {
  entries: ViewerEntry[];
  currentId: string;
  onChange: (id: string) => void;
  onClose: () => void;
  onReuse: (task: MaterialCanvasTask) => void;
  actions: (task: MaterialCanvasTask, slot: MaterialCanvasSlot) => React.ReactNode;
}) {
  const key = (entry: ViewerEntry) => `${entry.task.id}:${entry.slot.index}`;
  const index = Math.max(0, entries.findIndex((entry) => key(entry) === currentId));
  const entry = entries[index];
  const [size, setSize] = useState('');
  const [copied, setCopied] = useState(false);
  const [broken, setBroken] = useState(false);
  // 换了一张就清掉上一张的尺寸和「读不到」状态。
  useEffect(() => {
    setSize('');
    setBroken(false);
  }, [currentId]);
  const go = (step: number) => onChange(key(entries[(index + step + entries.length) % entries.length]));

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
  const time = new Date(entry.task.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const copyPrompt = async () => {
    try {
      await copyToClipboard(entry.task.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="modal-shell canvas-viewer" role="dialog" aria-modal="true" aria-label="全屏查看">
      <Button className="modal-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      {/* 左边大图，右边完整提示词和操作。图片列用 minmax(0, 1fr)，不会被长提示词撑宽把图挤出窗口。 */}
      <div className="canvas-viewer-body">
        <div
          className="canvas-viewer-media"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
          onLoadCapture={(event) => {
            const target = event.target as HTMLImageElement;
            if (target.naturalWidth) setSize(`${target.naturalWidth} × ${target.naturalHeight}`);
          }}
          onErrorCapture={() => setBroken(true)}
        >
          {broken ? (
            <p className="canvas-media-missing">读不到这张图：文件可能被删了，或者 NAS 暂时连不上</p>
          ) : isVideoSlot(entry.slot) ? (
            <video key={currentId} src={slotSrc(entry.slot, true)} controls playsInline />
          ) : (
            <img key={currentId} src={slotSrc(entry.slot, true)} alt="生成结果" />
          )}
        </div>
        <aside className="canvas-viewer-info">
          <div className="canvas-viewer-head">
            <span>
              {index + 1} / {entries.length}
            </span>
            {entries.length > 1 && (
              <>
                <Button className="icon-button" type="button" aria-label="上一张" title="上一张（←）" onClick={() => go(-1)}>
                  <ChevronLeft size={18} />
                </Button>
                <Button className="icon-button" type="button" aria-label="下一张" title="下一张（→）" onClick={() => go(1)}>
                  <ChevronRight size={18} />
                </Button>
              </>
            )}
            <Button className="icon-button" type="button" aria-label="关闭" title="关闭（Esc）" onClick={onClose}>
              <X size={18} />
            </Button>
          </div>
          <span className="canvas-viewer-meta">
            {time} · {entry.task.model}
            {size && !isVideoSlot(entry.slot) ? ` · ${size}` : ''}
          </span>
          {entry.slot.error && <p className="canvas-slot-warning">{entry.slot.error}</p>}
          <p className="canvas-viewer-prompt">{entry.task.prompt}</p>
          <div className="canvas-viewer-actions">
            <Button className="button ghost compact" type="button" onClick={() => void copyPrompt()}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? '已复制' : '复制提示词'}
            </Button>
            <Button className="button ghost compact" type="button" title="提示词、参数和当时的参考图都放回左边" onClick={() => onReuse(entry.task)}>
              <RotateCcw size={13} />
              全量恢复
            </Button>
          </div>
          {actions(entry.task, entry.slot)}
        </aside>
      </div>
    </div>
  );
}
