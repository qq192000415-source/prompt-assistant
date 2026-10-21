// 设置 › 皮肤 › 做一套皮肤（1.17.0）：图从 AI 生成、Wallhaven 壁纸库或本机来，软件按图的形状定摆法（横图铺满、竖图侧边立绘），
// 从图里取主色、定深浅、算磨砂玻璃的透明度，预览满意后存成一个皮肤包装上。算法在 src/skins/skinGenerator.ts。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ExternalLink, ImagePlus, Search, WandSparkles } from 'lucide-react';
import { Button } from './ui/button';
import type { ThemeMode } from '../lib/theme';
import type { SkinsController } from '../skins/useSkins';
import { analyzePixels, generatedManifest, imageShape, skinColors, skinTokens, suggestLayout, wallpaperPrompt, WALLPAPER_STYLES, type ImageInfo, type SkinChoice } from '../skins/skinGenerator';
import type { WallpaperLayout } from '../skins/skinPack';

type Source = 'ai' | 'wallhaven' | 'local';
type Picked = { src: string; image: HTMLImageElement; info: ImageInfo; name: string };
type WallhavenItem = Awaited<ReturnType<DesktopSkinsApi['wallhavenSearch']>>['items'][number];

const SOURCES: Array<{ value: Source; label: string }> = [
  { value: 'ai', label: 'AI 生成' },
  { value: 'wallhaven', label: 'Wallhaven 壁纸库' },
  { value: 'local', label: '本机图片' },
];
const LAYOUTS: Array<{ value: WallpaperLayout; label: string }> = [
  { value: 'cover', label: '全屏铺满' },
  { value: 'right', label: '立绘靠右' },
  { value: 'left', label: '立绘靠左' },
];
const MODES: Array<{ value: SkinChoice['mode']; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];
// 存进皮肤包的壁纸：铺满的最宽 2560，立绘最高 1600，够 2K 屏用，文件也不大
const MAX_COVER_WIDTH = 2560;
const MAX_TACHIE_HEIGHT = 1600;

const errorText = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error));

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读不出来'));
    image.src = src;
  });

function canvasOf(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  return { element, context: element.getContext('2d', { willReadFrequently: true })! };
}

// 缩成最长边 120 的小图给算法分析
function analyze(image: HTMLImageElement) {
  const scale = 120 / Math.max(image.naturalWidth, image.naturalHeight);
  const { element, context } = canvasOf(image.naturalWidth * scale, image.naturalHeight * scale);
  context.drawImage(image, 0, 0, element.width, element.height);
  return analyzePixels(context.getImageData(0, 0, element.width, element.height), image.naturalWidth / image.naturalHeight);
}

const toBytes = (element: HTMLCanvasElement, quality: number) =>
  new Promise<Uint8Array>((resolve, reject) =>
    element.toBlob((blob) => (blob ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject) : reject(new Error('图片编码失败'))), 'image/webp', quality),
  );

// 侧边立绘：图按高度贴一侧，朝内容那边渐隐到底色（和皮肤 CSS 里的遮罩一样）
function drawTachie(context: CanvasRenderingContext2D, image: HTMLImageElement, layout: WallpaperLayout, width: number, height: number, base: string) {
  const w = height * (image.naturalWidth / image.naturalHeight);
  const x = layout === 'right' ? width - w : 0;
  const layer = canvasOf(w, height);
  layer.context.drawImage(image, 0, 0, layer.element.width, layer.element.height);
  layer.context.globalCompositeOperation = 'destination-in';
  const fade = layer.context.createLinearGradient(layout === 'right' ? layer.element.width : 0, 0, layout === 'right' ? 0 : layer.element.width, 0);
  fade.addColorStop(0, '#000');
  fade.addColorStop(0.62, '#000');
  fade.addColorStop(1, 'transparent');
  layer.context.fillStyle = fade;
  layer.context.fillRect(0, 0, layer.element.width, layer.element.height);
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);
  context.drawImage(layer.element, x, 0);
}

export function SkinStudio({ skinPacks, onThemeChange, notify }: { skinPacks: SkinsController; onThemeChange: (theme: ThemeMode) => void; notify: (message: string) => void }) {
  const api = window.promptAssistantDesktop?.skins;
  const [source, setSource] = useState<Source>('ai');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [choice, setChoice] = useState<SkinChoice>({ layout: 'cover', accent: 0, mode: 'auto' });
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pick = async (src: string, label: string) => {
    setError('');
    try {
      const image = await loadImage(src);
      const info = analyze(image);
      setPicked({ src, image, info, name: label });
      setChoice({ layout: suggestLayout(info), accent: 0, mode: 'auto' });
      setName(label.slice(0, 20));
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const save = async () => {
    if (!api || !picked) return;
    const skinName = name.trim().slice(0, 20) || '我的皮肤';
    setSaving(true);
    setError('');
    try {
      const { image, info } = picked;
      const manifest = generatedManifest({ id: `my-${Date.now().toString(36)}`, name: skinName, info, choice });
      const colors = skinColors(info, choice);
      const cover = choice.layout === 'cover';
      const scale = Math.min(1, cover ? MAX_COVER_WIDTH / image.naturalWidth : MAX_TACHIE_HEIGHT / image.naturalHeight);
      const wall = canvasOf(image.naturalWidth * scale, image.naturalHeight * scale);
      wall.context.imageSmoothingQuality = 'high';
      wall.context.drawImage(image, 0, 0, wall.element.width, wall.element.height);
      let wallpaper = await toBytes(wall.element, 0.86);
      if (wallpaper.byteLength > 7 * 1024 * 1024) wallpaper = await toBytes(wall.element, 0.7);
      // 预览图 240×135：按摆法画壁纸，叠一条侧栏、一张卡片和主色按钮，菜单里一眼看得出效果
      const preview = canvasOf(240, 135);
      const { context } = preview;
      const focus = choice.focus ?? info.focus;
      if (cover) {
        const s = Math.max(240 / image.naturalWidth, 135 / image.naturalHeight);
        const w = image.naturalWidth * s;
        const h = image.naturalHeight * s;
        context.drawImage(image, (240 - w) * focus.x, (135 - h) * focus.y, w, h);
      } else {
        drawTachie(context, image, choice.layout, 240, 135, manifest.wallpaper!.base);
      }
      // 左下角一条主色，菜单里能看出按钮是什么颜色；立绘那边留给人物
      context.fillStyle = `rgb(${colors.accent.join(',')})`;
      context.beginPath();
      context.roundRect(choice.layout === 'left' ? 186 : 12, 117, 42, 8, 4);
      context.fill();
      const result = await api.installGenerated(manifest, { 'wallpaper.webp': wallpaper, 'preview.webp': await toBytes(preview.element, 0.9) });
      await skinPacks.reload();
      onThemeChange(`skin:${result.id}` as ThemeMode);
      notify(`已做好皮肤「${result.name}」并换上，不喜欢可以在下面的列表里删掉`);
      setPicked(null);
    } catch (caught) {
      setError(`皮肤没保存：${errorText(caught)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section" aria-labelledby="skin-studio-title">
      <div className="settings-section-title">
        <div>
          <h3 id="skin-studio-title">做一套皮肤</h3>
          <p>选一张图，软件自动定摆法（横图铺满、竖图做侧边立绘）、从图里取配色、保证字看得清。</p>
        </div>
      </div>
      {!api ? (
        <p className="settings-note">桌面版运行时可用。</p>
      ) : picked ? (
        <SkinEditor
          picked={picked}
          choice={choice}
          setChoice={setChoice}
          name={name}
          setName={setName}
          saving={saving}
          onSave={() => void save()}
          onBack={() => setPicked(null)}
        />
      ) : (
        <>
          <div className="canvas-segmented skin-studio-sources" role="radiogroup" aria-label="图从哪里来">
            {SOURCES.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={source === option.value} className={source === option.value ? 'is-active' : ''} onClick={() => setSource(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
          {source === 'ai' && <AiSource onPick={pick} />}
          {source === 'wallhaven' && <WallhavenSource onPick={pick} />}
          {source === 'local' && <LocalSource onPick={pick} />}
        </>
      )}
      {error && (
        <p className="settings-note is-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function AiSource({ onPick }: { onPick: (src: string, name: string) => void }) {
  const api = window.promptAssistantDesktop!.skins!;
  const [description, setDescription] = useState('');
  const [styles, setStyles] = useState<string[]>([]);
  const [composition, setComposition] = useState<'scene' | 'character'>('scene');
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const generate = async () => {
    setBusy(true);
    setStarted(Date.now());
    setNow(Date.now());
    setError('');
    setResults([]);
    try {
      const { images, errors } = await api.generateWallpaper(wallpaperPrompt({ description, styles, composition }), composition);
      setResults(images);
      if (errors.length) setError(`${images.length ? '有一张没生成出来' : '没生成出来'}：${errors[0]}`);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="skin-studio-source">
      <label className="field">
        想要什么样的壁纸
        <textarea rows={2} value={description} maxLength={300} placeholder="比如：月夜竹林，远处有亭子；或者：穿红黑长袍、拿笛子的少年" onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="canvas-template-chips" role="group" aria-label="风格（可多选）">
        {WALLPAPER_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            aria-pressed={styles.includes(style)}
            className={styles.includes(style) ? 'is-active' : ''}
            onClick={() => setStyles(styles.includes(style) ? styles.filter((entry) => entry !== style) : [...styles, style])}
          >
            {style}
          </button>
        ))}
      </div>
      <div className="skin-studio-row">
        <div className="canvas-segmented" role="radiogroup" aria-label="构图">
          <button type="button" role="radio" aria-checked={composition === 'scene'} className={composition === 'scene' ? 'is-active' : ''} onClick={() => setComposition('scene')}>
            全屏风景（横图）
          </button>
          <button type="button" role="radio" aria-checked={composition === 'character'} className={composition === 'character' ? 'is-active' : ''} onClick={() => setComposition('character')}>
            人物立绘（竖图）
          </button>
        </div>
        <Button className="button primary small-button" type="button" disabled={busy || (!description.trim() && !styles.length)} onClick={() => void generate()}>
          <WandSparkles size={14} />
          {busy ? `生成中 ${Math.round((now - started) / 1000)} 秒…` : '生成 2 张'}
        </Button>
      </div>
      <p className="settings-note">用「API 配置」里的生图模型，花你自己的额度，一次大约 1 分钟。构图要求（主体放一侧、留出空白）软件会自动加上。</p>
      {results.length > 0 && (
        <div className={`skin-studio-results ${composition === 'character' ? 'is-portrait' : ''}`}>
          {results.map((src, index) => (
            <button key={index} type="button" title="用这张做皮肤" onClick={() => onPick(src, description.trim() || styles.join('') || 'AI 皮肤')}>
              <img src={src} alt={`生成的第 ${index + 1} 张`} />
            </button>
          ))}
        </div>
      )}
      {error && <p className="settings-note is-error">{error}</p>}
    </div>
  );
}

function WallhavenSource({ onPick }: { onPick: (src: string, name: string) => void }) {
  const api = window.promptAssistantDesktop!.skins!;
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: WallhavenItem[]; failed: number; lastPage: number } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const search = async (nextPage: number) => {
    setBusy('search');
    setError('');
    try {
      setResult(await api.wallhavenSearch({ query, orientation, page: nextPage }));
      setPage(nextPage);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy('');
    }
  };

  const choose = async (item: WallhavenItem) => {
    setBusy(item.id);
    setError('');
    try {
      onPick(await api.wallhavenImage(item.id), query.trim() || 'Wallhaven');
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="skin-studio-source">
      <form
        className="skin-studio-row"
        onSubmit={(event) => {
          event.preventDefault();
          void search(1);
        }}
      >
        <input className="skin-studio-query" value={query} maxLength={100} placeholder="搜英文效果更好，比如 mountain、anime girl、city night；不填看热门" onChange={(event) => setQuery(event.target.value)} />
        <div className="canvas-segmented" role="radiogroup" aria-label="横竖">
          <button type="button" role="radio" aria-checked={orientation === 'landscape'} className={orientation === 'landscape' ? 'is-active' : ''} onClick={() => setOrientation('landscape')}>
            横图
          </button>
          <button type="button" role="radio" aria-checked={orientation === 'portrait'} className={orientation === 'portrait' ? 'is-active' : ''} onClick={() => setOrientation('portrait')}>
            竖图
          </button>
        </div>
        <Button className="button primary small-button" type="submit" disabled={Boolean(busy)}>
          <Search size={14} />
          {busy === 'search' ? '正在搜…' : '搜索'}
        </Button>
      </form>
      <p className="settings-note">来自 Wallhaven 免费壁纸库，只搜安全内容，横图至少 1920 宽、竖图至少 1600 高。图片版权归原作者，只供个人使用。连不上的话在「设置 › 网络」里设代理。</p>
      {result &&
        (result.items.length ? (
          <>
            <div className={`skin-studio-results is-grid ${orientation === 'portrait' ? 'is-portrait' : ''}`}>
              {result.items.map((item) => (
                <div key={item.id} className="skin-studio-thumb">
                  <button type="button" disabled={Boolean(busy)} title={`${item.width}×${item.height}，用这张做皮肤`} onClick={() => void choose(item)}>
                    <img src={item.thumb} alt={`${item.width}×${item.height}`} loading="lazy" />
                    {busy === item.id && <span>正在下载原图…</span>}
                  </button>
                  <a href={item.page} target="_blank" rel="noreferrer" title="在 Wallhaven 上查看作者和来源">
                    <ExternalLink size={12} />
                    {item.width}×{item.height}
                  </a>
                </div>
              ))}
            </div>
            {result.failed > 0 && <p className="settings-note">这一页有 {result.failed} 张缩略图没下载下来，没显示。</p>}
            <div className="skin-studio-row">
              <Button className="button ghost small-button" type="button" disabled={Boolean(busy) || page <= 1} onClick={() => void search(page - 1)}>
                上一页
              </Button>
              <span className="settings-note">
                第 {page} / {result.lastPage} 页
              </span>
              <Button className="button ghost small-button" type="button" disabled={Boolean(busy) || page >= result.lastPage} onClick={() => void search(page + 1)}>
                下一页
              </Button>
            </div>
          </>
        ) : (
          <p className="settings-note">没搜到，换个词试试（英文关键词结果多）。</p>
        ))}
      {error && <p className="settings-note is-error">{error}</p>}
    </div>
  );
}

function LocalSource({ onPick }: { onPick: (src: string, name: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="skin-studio-source">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(URL.createObjectURL(file), file.name.replace(/\.[^.]+$/, ''));
        }}
      />
      <Button className="button ghost small-button" type="button" onClick={() => input.current?.click()}>
        <ImagePlus size={14} />
        选一张图片
      </Button>
      <p className="settings-note">画布生成的图、素材库里的图都可以先另存到本机再选。横图会铺满，竖图会做成侧边立绘。</p>
    </div>
  );
}

type EditorProps = {
  picked: Picked;
  choice: SkinChoice;
  setChoice: (choice: SkinChoice) => void;
  name: string;
  setName: (name: string) => void;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
};

// 预览：一个缩小的灵匣窗口，颜色、壁纸摆法和真的皮肤一样算
function SkinEditor({ picked, choice, setChoice, name, setName, saving, onSave, onBack }: EditorProps) {
  const { info, src } = picked;
  const colors = useMemo(() => skinColors(info, choice), [info, choice]);
  const tokens = useMemo(() => skinTokens(colors), [colors]);
  const focus = choice.focus ?? info.focus;
  const cover = choice.layout === 'cover';
  const frameHeight = 260;
  const style = { ...tokens, background: `rgb(${colors.wallpaperBase.join(',')})` } as CSSProperties;
  const mask = `linear-gradient(${choice.layout === 'right' ? 'to left' : 'to right'}, #000 62%, transparent), linear-gradient(to bottom, #000 85%, transparent)`;
  const wallStyle: CSSProperties = cover
    ? { inset: 0, backgroundImage: `url("${src}")`, backgroundSize: 'cover', backgroundPosition: `${focus.x * 100}% ${focus.y * 100}%` }
    : { top: 0, bottom: 0, [choice.layout]: 0, width: frameHeight * info.aspect, backgroundImage: `url("${src}")`, backgroundSize: 'cover', WebkitMaskImage: mask, WebkitMaskComposite: 'source-in', maskImage: mask, maskComposite: 'intersect' };
  const screenNeed = Math.round((cover ? window.screen.width : window.screen.height) * (window.devicePixelRatio || 1));
  const have = cover ? picked.image.naturalWidth : picked.image.naturalHeight;
  const small = have < screenNeed * 0.75;

  return (
    <div className="skin-studio-editor">
      <div className="skin-studio-preview" style={style} aria-label="皮肤预览">
        <div className="skin-studio-wall" style={wallStyle} />
        <div className="skin-studio-mock">
          <div className="skin-studio-mock-top">
            <span className="is-on">提示词</span>
            <span>文档</span>
            <span>素材</span>
            <span>画布</span>
          </div>
          <div className="skin-studio-mock-body">
            <div className="skin-studio-mock-side">
              <b>提示词</b>
              <i className="is-accent">＋ 新建提示词</i>
              <i className="is-on">电商生图指令</i>
              <i>开发流程</i>
              <i>未分类</i>
            </div>
            <div className="skin-studio-mock-main" style={{ maxWidth: choice.layout !== 'right' ? undefined : `max(55%,calc(100% - ${Math.round(frameHeight * info.aspect * 0.62)}px))` }}>
              <div className="skin-studio-mock-card">
                <b>国风产品主图</b>
                <p>基于图片的风格，生成一张电商主图，产品是保温杯，场景和氛围 AI 补全。</p>
                <i className="is-accent">复制提示词</i>
              </div>
              <div className="skin-studio-mock-card">
                <b>科技服务海报</b>
                <p>1:1 正方形画幅，平视近景构图，人物在右侧三分之一。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="skin-studio-controls">
        <label className="field">
          皮肤名称
          <input value={name} maxLength={20} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="field">
          摆法
          <div className="canvas-segmented" role="radiogroup" aria-label="摆法">
            {LAYOUTS.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={choice.layout === option.value} className={choice.layout === option.value ? 'is-active' : ''} onClick={() => setChoice({ ...choice, layout: option.value })}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          主色（从图里挑的）
          <div className="skin-studio-swatches" role="radiogroup" aria-label="主色">
            {colors.swatches.map((color, index) => (
              <button key={color + index} type="button" role="radio" aria-checked={choice.accent === index} aria-label={`候选色 ${index + 1}`} style={{ background: color }} className={choice.accent === index ? 'is-active' : ''} onClick={() => setChoice({ ...choice, accent: index })} />
            ))}
          </div>
        </div>
        <div className="field">
          明暗
          <div className="canvas-segmented" role="radiogroup" aria-label="明暗">
            {MODES.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={choice.mode === option.value} className={choice.mode === option.value ? 'is-active' : ''} onClick={() => setChoice({ ...choice, mode: option.value })}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {cover && (
          <div className="field">
            主体位置（点图上的一处，窗口变窄时优先保住它）
            <button
              type="button"
              className="skin-studio-focus"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setChoice({ ...choice, focus: { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height } });
              }}
            >
              <img src={src} alt="" />
              <i style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }} />
            </button>
          </div>
        )}
        <ul className="skin-studio-report">
          <li>
            {picked.image.naturalWidth}×{picked.image.naturalHeight}，{imageShape(info.aspect)}，界面用{colors.dark ? '深色' : '浅色'}
          </li>
          <li>正文最差对比度 {colors.worstContrast.toFixed(1)}:1{colors.worstContrast >= 7 ? '，看得清' : '，偏低'}</li>
          {small && <li className="is-warn">图片偏小：这块屏幕需要约 {screenNeed} 像素，图只有 {have}，会有点发虚</li>}
        </ul>
        <div className="skin-studio-row">
          <Button className="button ghost small-button" type="button" disabled={saving} onClick={onBack}>
            换一张图
          </Button>
          <Button className="button primary small-button" type="button" disabled={saving} onClick={onSave}>
            {saving ? '正在保存…' : '保存并换上'}
          </Button>
        </div>
      </div>
    </div>
  );
}
