import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, FileUp, ImagePlus, Maximize, Minimize, RotateCcw, RotateCw, Save, Trash2, TriangleAlert, Type } from 'lucide-react';
import { Button } from '../ui/button';
import { MeshEditor } from './MeshEditor';
import { RetouchCompare, RetouchPanel, type LocalKind } from './RetouchPanel';
import { bytesOf, dataUrlOf, localEdit, outpaint, plainUpscale, restore, type RetouchResult } from '../../custom/retouchCanvas';
import { MAX_UPSCALE_INPUT } from '../../custom/retouch';
import { TextLayerPanel } from './TextLayerPanel';
import { ReferenceEditor, type EditorMode } from '../materials/ReferenceEditor';
import type { Point } from '../../materials/imageEdit';
import { LOW_DPI, emptyFace, facesFor, fitLayer, imageLayers, isTextLayer, newTextLayer, printDpi, type FaceLayout, type ImageLayer, type Layer, type OrderLayout } from '../../custom/layout';
import type { CustomProduct, MockupTemplate } from '../../custom/product';
import { cmToPx, productionFileName } from '../../custom/production';
import { encodeJpeg, encodePng, encodeProductionJpeg, mockupFocus, renderConfirmation, renderFace, renderMockup, renderProduction, textBox, type Drawable, type MockupAssets } from '../../custom/render';
import { defaultMesh, warpedBounds } from '../../custom/warp';

// 来图定制：选产品和尺寸 → 放买家的图排版 → 右边实时出样机效果 → 复制效果图 / 存一版到定制 NAS / 导出生产图。
// 样机在左栏「产品设置」里做：导入 PSD，或者用一张空白产品照拖网格（1.18.1），团队共用。
// 发给买家的一律是正反面并排的对照图（1.18.2 起两面相同也是，标「两面同图」，免得买家以为背面空白）。

type Source = { sha256: string; ext: string; bytes: Uint8Array<ArrayBuffer>; bitmap: ImageBitmap };
type Face = 'front' | 'back';

const PREVIEW_FACE = 1024;
const STAGE_FACE = 900;
// IPC 抛回来的错误前面会带一串「Error invoking remote method …: Error:」，只留后面的中文。
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
type PhotoEdit = { bytes: Uint8Array<ArrayBuffer>; ext: string; bitmap: ImageBitmap; url: string; mesh: Point[] };

// 照片样机的模板：四角取网格外框，网格控制点原样就是贴图位置；光影靠正片叠底取照片本身。
function photoTemplate(edit: PhotoEdit): MockupTemplate {
  const { minX, minY, maxX, maxY } = warpedBounds(edit.mesh);
  const { width, height } = edit.bitmap;
  return {
    width,
    height,
    smartObject: { width, height, quad: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }], mesh: edit.mesh },
    blend: 'multiply',
    opacity: 1,
    clipped: false,
    underFile: `under${edit.ext}`,
    underIncludesBase: true,
    over: [],
    hasSample: false,
  };
}

// 还没放图时，照片样机预览用一张浅灰网格看变形对不对。
function gridFace(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = size / 200;
  for (let i = 0; i <= 8; i += 1) {
    const at = (i / 8) * size;
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, size);
    ctx.moveTo(0, at);
    ctx.lineTo(size, at);
    ctx.stroke();
  }
  return canvas;
}
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
const extOf = (name: string, type: string) => {
  const fromName = name.match(/\.(png|jpe?g|webp|bmp)$/i)?.[0].toLowerCase();
  if (fromName) return fromName === '.jpeg' ? '.jpg' : fromName;
  return type === 'image/jpeg' ? '.jpg' : type === 'image/webp' ? '.webp' : '.png';
};

function useTemplateAssets(product: CustomProduct | null, notify: (message: string) => void) {
  const [assets, setAssets] = useState<(MockupAssets & { sample: Uint8Array<ArrayBuffer> | null }) | null>(null);
  const customApi = window.promptAssistantDesktop?.custom;
  const key = product?.template ? `${product.id}:${product.updatedAt}` : '';
  useEffect(() => {
    setAssets(null);
    if (!customApi || !product?.template) return;
    let alive = true;
    const read = async (file: string) => createImageBitmap(new Blob([await customApi.readTemplateFile(product.id, file)]));
    const template = product.template;
    void (async () => {
      // base 只有剪贴时（和 1.18.0 的旧模板）才有。
      const [under, base, over] = await Promise.all([
        read(template.underFile),
        template.clipped || !template.underIncludesBase ? read('base.png') : Promise.resolve(null),
        Promise.all(template.over.map((entry) => read(entry.file))),
      ]);
      let sample: Uint8Array<ArrayBuffer> | null = null;
      if (template.hasSample) {
        for (const file of ['sample.jpg', 'sample.png', 'sample.webp']) {
          sample = await customApi.readTemplateFile(product.id, file).catch(() => null);
          if (sample) break;
        }
      }
      if (alive) setAssets({ under, base, over, sample });
    })().catch((error) => alive && notify(`样机读不出来：${messageOf(error)}`));
    return () => {
      alive = false;
    };
  }, [key]);
  return assets;
}

export function CustomOrderView({ team, notify }: { team: string; notify: (message: string) => void }) {
  const customApi = window.promptAssistantDesktop?.custom;
  const [products, setProducts] = useState<CustomProduct[] | null>(null);
  const [productId, setProductId] = useState('');
  const [productForm, setProductForm] = useState<{ id?: string; name: string; sizes: string; bleedCm: string; watermark: string } | null>(null);
  const [orderName, setOrderName] = useState('');
  const [layout, setLayout] = useState<OrderLayout | null>(null);
  const [editing, setEditing] = useState<Face>('front');
  const [selectedId, setSelectedId] = useState('');
  const [sources, setSources] = useState<Map<string, Source>>(new Map());
  const [busy, setBusy] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const stageCanvas = useRef<HTMLCanvasElement>(null);
  const mockupCanvas = useRef<HTMLCanvasElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoEdit, setPhotoEdit] = useState<PhotoEdit | null>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; cx: number; cy: number; size: number } | null>(null);
  // 正在中间区域修的图，以及每一层修图前的样子（撤销用，只在内存里）。
  const [retouch, setRetouch] = useState<{ layerId: string; mode: EditorMode; dataUrl: string; local?: { kind: LocalKind; custom: string } } | null>(null);
  // AI 出的结果先左右对照，点「用这张」才换进排版。
  const [upscaleProgress, setUpscaleProgress] = useState('');
  const [pending, setPending] = useState<{ layerId: string; before: string; after: string; result: RetouchResult; refit: boolean; note: string } | null>(null);
  const [retouchHistory, setRetouchHistory] = useState<Map<string, ImageLayer[]>>(new Map());

  const product = products?.find((entry) => entry.id === productId) ?? null;
  const assets = useTemplateAssets(product, notify);
  const bitmaps = useMemo(() => new Map<string, Drawable>([...sources].map(([sha, source]) => [sha, source.bitmap])), [sources]);
  const face = layout ? (editing === 'back' && layout.facesMode === 'different' ? layout.back : layout.front) : null;
  const selected = face?.layers.find((layer) => layer.id === selectedId) ?? null;

  const loadProducts = async (prefer?: string) => {
    if (!customApi) return;
    try {
      const { products: list, dropped } = await customApi.listProducts();
      setProducts(list);
      if (dropped) notify(`产品配置里有 ${dropped} 条读不懂，已跳过；下次保存时它们不会被保留`);
      setProductId((current) => prefer ?? (list.some((entry) => entry.id === current) ? current : (list[0]?.id ?? '')));
    } catch (error) {
      setProducts([]);
      notify(`读取产品失败：${messageOf(error)}`);
    }
  };
  useEffect(() => {
    void loadProducts();
  }, []);

  // 换产品时重新开一份排版，尺寸默认第一个。
  useEffect(() => {
    if (!product) return setLayout(null);
    setLayout((current) =>
      current && current.productId === product.id
        ? current
        : { productId: product.id, sizeCm: product.sizes[0] ?? 40, facesMode: 'same', front: emptyFace(), back: emptyFace() },
    );
  }, [product?.id]);

  const updateFace = (target: Face, change: (face: FaceLayout) => FaceLayout) =>
    setLayout((current) => (current ? { ...current, [target === 'back' && current.facesMode === 'different' ? 'back' : 'front']: change(target === 'back' && current.facesMode === 'different' ? current.back : current.front) } : current));
  const replaceLayer = (id: string, change: (layer: Layer) => Layer) => updateFace(editing, (current) => ({ ...current, layers: current.layers.map((layer) => (layer.id === id ? change(layer) : layer)) }));
  const updateLayer = (id: string, patch: Partial<ImageLayer> | Partial<Layer>) => replaceLayer(id, (layer) => ({ ...layer, ...patch }) as Layer);

  const addImages = async (files: Array<{ name: string; type: string; bytes: Uint8Array<ArrayBuffer> }>) => {
    for (const file of files) {
      try {
        const bitmap = await createImageBitmap(new Blob([file.bytes]));
        const sha256 = hex(await crypto.subtle.digest('SHA-256', file.bytes));
        const ext = extOf(file.name, file.type);
        setSources((current) => new Map(current).set(sha256, { sha256, ext, bytes: file.bytes, bitmap }));
        const layer: ImageLayer = { id: crypto.randomUUID(), sha256, ext, width: bitmap.width, height: bitmap.height, ...fitLayer(bitmap.width, bitmap.height, 'cover') };
        updateFace(editing, (current) => ({ ...current, layers: [...current.layers, layer] }));
        setSelectedId(layer.id);
      } catch {
        notify(`「${file.name}」不是能读的图片`);
      }
    }
  };
  const addText = () => {
    const layer = newTextLayer('Microsoft YaHei');
    updateFace(editing, (current) => ({ ...current, layers: [...current.layers, layer] }));
    setSelectedId(layer.id);
  };

  // 修好的图作为新原图加进来，换掉这一层；比例变了的（裁剪、透视）按铺满重新摆，比例没变的位置大小不动。
  // 第一次修时记下买家原图（originalSha256），保存时一起存。
  const applyRetouch = async (layerId: string, bytes: Uint8Array<ArrayBuffer>, ext: string, refit: boolean) => {
    const before = face?.layers.find((layer) => layer.id === layerId);
    if (!before || isTextLayer(before)) return;
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
    setSources((current) => new Map(current).set(sha256, { sha256, ext, bytes, bitmap }));
    setRetouchHistory((current) => new Map(current).set(layerId, [...(current.get(layerId) ?? []), before]));
    replaceLayer(layerId, () => ({
      ...before,
      ...(refit ? fitLayer(bitmap.width, bitmap.height, 'cover') : {}),
      sha256,
      ext,
      width: bitmap.width,
      height: bitmap.height,
      originalSha256: before.originalSha256 ?? before.sha256,
      originalExt: before.originalExt ?? before.ext,
    }));
  };
  const undoRetouch = (layerId: string) => {
    const stack = retouchHistory.get(layerId) ?? [];
    const previous = stack.at(-1);
    if (!previous) return;
    setRetouchHistory((current) => new Map(current).set(layerId, stack.slice(0, -1)));
    replaceLayer(layerId, () => previous);
  };
  const selectedSource = () => {
    if (!selected || isTextLayer(selected)) throw new Error('先选一张图');
    const source = sources.get(selected.sha256);
    if (!source) throw new Error('这张图还没读出来，请稍后再试');
    return { layer: selected, source };
  };
  const startRetouch = (mode: EditorMode, local?: { kind: LocalKind; custom: string }) =>
    run('retouch', async () => {
      const { layer, source } = selectedSource();
      setRetouch({ layerId: layer.id, mode, dataUrl: await dataUrlOf(source.bytes, source.ext), local });
    });
  const showResult = async (layerId: string, source: Source, result: RetouchResult, refit: boolean, note: string) => {
    const blobUrl = (bytes: Uint8Array<ArrayBuffer>) => URL.createObjectURL(new Blob([bytes]));
    setPending({ layerId, before: blobUrl(source.bytes), after: blobUrl(result.bytes), result, refit, note });
  };
  const closePending = () => {
    if (pending) [pending.before, pending.after].forEach((url) => URL.revokeObjectURL(url));
    setPending(null);
  };
  const aiEdit = customApi?.aiEdit;
  const runOutpaint = (extra: number) =>
    run('outpaint', async () => {
      const { layer, source } = selectedSource();
      await showResult(layer.id, source, await outpaint(aiEdit!, source.bitmap, extra), true, '四周是 AI 补出来的（颜色已对齐原图，分辨率比原图低一些），原图一个像素都没改。看接缝自然再用。');
    });
  // 高清放大：第一次用先下载组件；AI 放大跑不了（显卡不支持等）时退回普通放大，并在对照里写明。
  const runUpscale = (model: 'photo' | 'anime') =>
    run('upscale', async () => {
      const { layer, source } = selectedSource();
      if (Math.max(source.bitmap.width, source.bitmap.height) > MAX_UPSCALE_INPUT) throw new Error(`原图已经够大（最长边超过 ${MAX_UPSCALE_INPUT} 像素），不用放大`);
      const status = await customApi!.upscalerStatus();
      if (!status.installed) {
        if (!window.confirm(`第一次用要下载高清放大组件（约 ${Math.round(status.downloadBytes / 1024 / 1024)}MB，只下载一次）。继续吗？`)) return;
        const stop = window.promptAssistantDesktop?.materials?.onProgress((progress) => {
          if (progress.task === '下载高清放大组件') setUpscaleProgress(`正在下载组件 ${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`);
        });
        try {
          await customApi!.installUpscaler();
        } finally {
          stop?.();
        }
      }
      setUpscaleProgress('正在放大，一般几秒到半分钟…');
      try {
        const upscaled = await customApi!.upscale({ bytes: source.bytes, ext: source.ext, model });
        if ('bytes' in upscaled) {
          await showResult(layer.id, source, { bytes: upscaled.bytes, ext: '.png' }, false, `AI 放大 4 倍（${model === 'anime' ? '插画模型' : '照片模型'}）。放大看细节，文字、五官有没有被改形。`);
        } else {
          await showResult(layer.id, source, await plainUpscale(source.bitmap), false, `没用上 AI 放大（${upscaled.error}），用的是普通放大：只是变大，细节不会变多。`);
        }
      } finally {
        setUpscaleProgress('');
      }
    });
  const runRestore = () => {
    if (!window.confirm('AI 变清晰会把整张图重画一遍，人脸、文字可能被改。生成后请仔细和原图核对再用。继续吗？')) return;
    void run('restore', async () => {
      const { layer, source } = selectedSource();
      await showResult(layer.id, source, await restore(aiEdit!, source.bitmap), false, '整张是 AI 重画的，颜色已拉回原图的色调：仔细看人脸、五官、文字有没有被改。');
    });
  };

  const addFileList = async (list: FileList | null) =>
    addImages(await Promise.all([...(list ?? [])].filter((file) => file.type.startsWith('image/')).map(async (file) => ({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }))));

  // 排版画布：拖动移动选中的图。
  useEffect(() => {
    const canvas = stageCanvas.current;
    if (!canvas || !face) return;
    try {
      const rendered = renderFace(face, bitmaps, STAGE_FACE);
      const ctx = canvas.getContext('2d')!;
      canvas.width = STAGE_FACE;
      canvas.height = STAGE_FACE;
      ctx.drawImage(rendered, 0, 0);
    } catch {
      // 图还在读，读完会再画一次。
    }
  }, [face, bitmaps]);

  // 右边效果图：排版停下 150ms 后重画，显示的就是要发给买家的正反面对照图（所见即所得，1.18.3）；
  // 正在用照片做样机时只出一面，按正在拖的网格看贴得对不对。
  useEffect(() => {
    if (!layout) return;
    const timer = window.setTimeout(() => {
      try {
        let mockup: HTMLCanvasElement;
        if (photoEdit) {
          const front = facesFor(layout).front;
          const face = front.layers.length ? renderFace(front, bitmaps, PREVIEW_FACE) : gridFace(PREVIEW_FACE);
          mockup = renderMockup(photoTemplate(photoEdit), { under: photoEdit.bitmap, base: null, over: [] }, face);
        } else {
          if (!product?.template || !assets) return;
          mockup = confirmationOf();
        }
        const target = mockupCanvas.current;
        if (target) {
          target.width = mockup.width;
          target.height = mockup.height;
          target.getContext('2d')!.drawImage(mockup, 0, 0);
        }
      } catch {
        // 图还在读。
      }
    }, photoEdit ? 60 : 150);
    return () => window.clearTimeout(timer);
  }, [layout, assets, bitmaps, product, photoEdit, orderName]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      notify(messageOf(error));
    } finally {
      setBusy('');
    }
  };

  // 两面都贴在同一个样机上，并排成对照图发给买家（两面相同时标「两面同图」）。
  const mockupOf = (target: Face) => {
    if (!layout || !product?.template || !assets) throw new Error('这个产品还没有样机，请先在「产品设置」里导入样机');
    const faces = facesFor(layout);
    return renderMockup(product.template, assets, renderFace(target === 'back' ? faces.back : faces.front, bitmaps, PREVIEW_FACE), product.watermark);
  };
  const confirmationOf = () => {
    const meta = [layout?.facesMode === 'same' && '两面同图', orderName.trim() && `单号 ${orderName.trim()}`, layout && `${layout.sizeCm}×${layout.sizeCm}cm`].filter(Boolean).join('  ·  ');
    return renderConfirmation(mockupOf('front'), mockupOf('back'), mockupFocus(product!.template!), meta);
  };
  const productionFile = async () => {
    if (!layout) throw new Error('还没有排版');
    const size = cmToPx(layout.sizeCm);
    const faces = facesFor(layout);
    const front = renderFace(faces.front, bitmaps, size);
    const back = layout.facesMode === 'same' ? front : renderFace(faces.back, bitmaps, size);
    return { name: productionFileName(layout.sizeCm, orderName), bytes: await encodeProductionJpeg(renderProduction(front, back, layout.sizeCm)) };
  };

  const copyEffect = () =>
    run('copy', async () => {
      await customApi!.copyImage(new Uint8Array(await (await encodePng(confirmationOf())).arrayBuffer()));
      notify('正反面对照图已复制，可以粘贴到千牛');
    });
  const saveVersion = () =>
    run('save', async () => {
      if (!layout) return;
      if (!orderName.trim()) throw new Error('先填单号（或名称），生产图和这一版都按它命名');
      const outputs = [{ name: '效果图-正面.jpg', bytes: await encodeJpeg(mockupOf('front')) }];
      if (layout.facesMode === 'different') outputs.push({ name: '效果图-背面.jpg', bytes: await encodeJpeg(mockupOf('back')) });
      outputs.push({ name: '效果确认.jpg', bytes: await encodeJpeg(confirmationOf()) });
      outputs.push(await productionFile());
      const used = new Set(imageLayers(layout).flatMap((layer) => [layer.sha256, ...(layer.originalSha256 ? [layer.originalSha256] : [])]));
      const { version } = await customApi!.saveOrderVersion({
        name: orderName,
        layout,
        sources: [...sources.values()].filter((source) => used.has(source.sha256)).map(({ sha256, ext, bytes }) => ({ sha256, ext, bytes })),
        outputs,
      });
      notify(`已保存第 ${version} 版到定制 NAS`);
    });
  const exportProduction = () =>
    run('export', async () => {
      if (!orderName.trim()) throw new Error('先填单号（或名称），生产图按它命名');
      const result = await customApi!.exportFiles([await productionFile()]);
      if (result) notify(`生产图已保存到 ${result.folder}`);
    });

  const saveProductForm = () =>
    run('product', async () => {
      if (!productForm) return;
      const sizes = productForm.sizes.split(/[,，、\s]+/).map(Number).filter((size) => size > 0);
      const saved = await customApi!.saveProduct({ id: productForm.id, name: productForm.name, sizes, bleedCm: Number(productForm.bleedCm), watermark: productForm.watermark });
      setProductForm(null);
      await loadProducts(saved.id);
      notify('产品已保存');
    });
  // 用照片做样机：选一张空白产品照，在中间拖网格，右边实时看效果，保存后整个团队都能用。
  const startPhotoTemplate = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bitmap = await createImageBitmap(new Blob([bytes]));
      setPhotoEdit({ bytes, ext: extOf(file.name, file.type), bitmap, url: URL.createObjectURL(file), mesh: defaultMesh(bitmap.width, bitmap.height) });
      setSelectedId('');
    } catch {
      notify(`「${file.name}」不是能读的图片`);
    }
  };
  const closePhotoTemplate = () => {
    if (photoEdit) URL.revokeObjectURL(photoEdit.url);
    setPhotoEdit(null);
  };
  const savePhotoTemplate = () =>
    run('photo', async () => {
      if (!product || !photoEdit) return;
      const { bytes, ext, bitmap, mesh } = photoEdit;
      await customApi!.savePhotoTemplate(product.id, { bytes, ext, width: bitmap.width, height: bitmap.height, mesh });
      closePhotoTemplate();
      await loadProducts(product.id);
      notify('样机已保存');
    });
  const deleteProduct = () =>
    run('product', async () => {
      if (!product) return;
      if (!window.confirm(`删除产品「${product.name}」？样机会一起删掉，团队里所有人都不能再用；已保存的单不受影响。`)) return;
      try {
        await customApi!.deleteProduct(product.id);
      } finally {
        await loadProducts();
      }
      notify(`产品「${product.name}」已删除`);
    });
  const importPsd = () =>
    run('psd', async () => {
      if (!product) return;
      const result = await customApi!.importPsd(product.id);
      if (!result) return;
      await loadProducts(product.id);
      notify(result.sampleExt ? '样机已导入，可以点「用示例图预览」看效果' : '样机已导入');
    });

  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!face) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    // 点到哪张图就选哪张（从上往下找，按没旋转的框算）；点空白处拖动当前选中的。
    const hit = [...face.layers].reverse().find((layer) => {
      const box = isTextLayer(layer) ? textBox(layer) : { width: layer.scale, height: (layer.scale * layer.height) / layer.width };
      const halfW = box.width / 2;
      const halfH = box.height / 2;
      return Math.abs(x - layer.cx) <= halfW && Math.abs(y - layer.cy) <= halfH;
    });
    const target = hit ?? selected;
    if (!target) return;
    setSelectedId(target.id);
    drag.current = { id: target.id, startX: event.clientX, startY: event.clientY, cx: target.cx, cy: target.cy, size: rect.width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    updateLayer(state.id, { cx: state.cx + (event.clientX - state.startX) / state.size, cy: state.cy + (event.clientY - state.startY) / state.size });
  };

  const moveLayer = (delta: number) =>
    updateFace(editing, (current) => {
      const index = current.layers.findIndex((layer) => layer.id === selectedId);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= current.layers.length) return current;
      const layers = [...current.layers];
      [layers[index], layers[next]] = [layers[next], layers[index]];
      return { ...current, layers };
    });

  if (!customApi) return <main className="custom-empty">来图定制只能在桌面版里使用</main>;

  const bleedPercent = layout && product ? (product.bleedCm / layout.sizeCm) * 100 : 0;
  // 正在排的这一面里，按现在大小印出来不到 150dpi 的图。
  const lowResLayers = layout && face ? face.layers.filter((layer): layer is ImageLayer => !isTextLayer(layer)).map((layer) => printDpi(layer, cmToPx(layout.sizeCm))).filter((dpi) => dpi < LOW_DPI) : [];
  return (
    <main className="materials-view is-canvas custom-view">
      <div className="custom-layout">
        <aside className="canvas-panel custom-panel" aria-label="产品和排版">
          <div className="canvas-panel-head">
            <strong>来图定制</strong>
            <span className="nas-form-note">{team}</span>
          </div>

          <label className="field">
            <span>单号或名称</span>
            <input value={orderName} onChange={(event) => setOrderName(event.target.value)} placeholder="比如淘宝订单号" />
          </label>

          <div className="canvas-section">
            <span className="material-field-label">产品</span>
            {products === null ? (
              <p className="nas-form-note">正在读取产品…</p>
            ) : products.length ? (
              <select className="custom-select" value={productId} onChange={(event) => setProductId(event.target.value)} aria-label="产品">
                {products.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.template ? '' : '（还没有样机）'}
                  </option>
                ))}
              </select>
            ) : (
              <p className="nas-form-note">还没有产品，先新建一个，再导入它的样机 PSD。</p>
            )}
            {product && layout && (
              <>
                <div className="canvas-segmented" role="radiogroup" aria-label="尺寸">
                  {product.sizes.map((size) => (
                    <button key={size} type="button" role="radio" aria-checked={layout.sizeCm === size} className={layout.sizeCm === size ? 'is-active' : ''} onClick={() => setLayout({ ...layout, sizeCm: size })}>
                      {size}cm
                    </button>
                  ))}
                </div>
                <div className="canvas-segmented" role="radiogroup" aria-label="两面">
                  {(['same', 'different'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={layout.facesMode === mode}
                      className={layout.facesMode === mode ? 'is-active' : ''}
                      onClick={() => {
                        // 切成两面不同时，背面从正面复制一份起步。
                        setLayout({ ...layout, facesMode: mode, back: mode === 'different' && layout.back.layers.length === 0 ? layout.front : layout.back });
                        if (mode === 'same') setEditing('front');
                      }}
                    >
                      {mode === 'same' ? '两面相同' : '两面不同'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <details className="custom-product-settings" open={products !== null && products.length === 0}>
            <summary>产品设置</summary>
            {productForm ? (
              <div className="custom-product-form">
                <label className="field">
                  <span>名称</span>
                  <input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} placeholder="方形抱枕" />
                </label>
                <label className="field">
                  <span>尺寸（cm，逗号分开）</span>
                  <input value={productForm.sizes} onChange={(event) => setProductForm({ ...productForm, sizes: event.target.value })} placeholder="40, 45, 50" />
                </label>
                <label className="field">
                  <span>出血（cm）</span>
                  <input value={productForm.bleedCm} onChange={(event) => setProductForm({ ...productForm, bleedCm: event.target.value })} inputMode="decimal" />
                </label>
                <label className="field">
                  <span>效果图水印（可空）</span>
                  <input value={productForm.watermark} onChange={(event) => setProductForm({ ...productForm, watermark: event.target.value })} placeholder="比如店铺名" />
                </label>
                <span className="custom-row">
                  <Button className="button ghost compact" type="button" onClick={() => setProductForm(null)}>
                    取消
                  </Button>
                  <Button className="button primary compact" type="button" disabled={busy === 'product'} onClick={() => void saveProductForm()}>
                    保存
                  </Button>
                </span>
              </div>
            ) : (
              <span className="custom-row">
                <Button className="button ghost compact" type="button" onClick={() => setProductForm({ name: '', sizes: '40, 45, 50', bleedCm: '0.5', watermark: '' })}>
                  新建产品
                </Button>
                {product && (
                  <>
                    <Button
                      className="button ghost compact"
                      type="button"
                      onClick={() => setProductForm({ id: product.id, name: product.name, sizes: product.sizes.join(', '), bleedCm: String(product.bleedCm), watermark: product.watermark })}
                    >
                      修改
                    </Button>
                    <Button className="button ghost compact" type="button" disabled={busy === 'product' || Boolean(photoEdit)} onClick={() => void deleteProduct()}>
                      <Trash2 size={13} />
                      删除产品
                    </Button>
                    <Button className="button ghost compact" type="button" disabled={busy === 'psd' || Boolean(photoEdit)} onClick={() => void importPsd()}>
                      <FileUp size={13} />
                      {busy === 'psd' ? '导入中…' : product.template ? '换样机 PSD' : '导入样机 PSD'}
                    </Button>
                    <Button className="button ghost compact" type="button" disabled={Boolean(photoEdit)} title="选一张空白产品照，拖网格对准产品轮廓" onClick={() => photoInput.current?.click()}>
                      <ImagePlus size={13} />
                      用图片做样机
                    </Button>
                    <input
                      ref={photoInput}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      onChange={(event) => void startPhotoTemplate(event.target.files?.[0]).then(() => (event.target.value = ''))}
                    />
                  </>
                )}
              </span>
            )}
            <p className="nas-form-note">
              两种做法：导入样机 PSD（换图的那层要是智能对象，常用的混合模式、剪贴、蒙版、色阶、曲线、黑白都认）；或者用一张空白产品照，拖网格对准产品，光影直接取照片，适合白色、浅色产品。
            </p>
          </details>

          {selected && (
            <div className="canvas-section custom-layer-tools" aria-label={isTextLayer(selected) ? '选中的文字' : '选中的图'}>
              <span className="material-field-label">{isTextLayer(selected) ? '选中的文字' : '选中的图'}</span>
              {isTextLayer(selected) ? (
                <TextLayerPanel layer={selected} onChange={(patch) => updateLayer(selected.id, patch)} />
              ) : (
                <label className="field">
                  <span>大小 {Math.round(selected.scale * 100)}%</span>
                  <input type="range" min={5} max={400} value={Math.round(selected.scale * 100)} onChange={(event) => updateLayer(selected.id, { scale: Number(event.target.value) / 100 })} />
                </label>
              )}
              <label className="field">
                <span>角度 {Math.round(selected.rotation)}°</span>
                <input type="range" min={-180} max={180} value={Math.round(selected.rotation)} onChange={(event) => updateLayer(selected.id, { rotation: Number(event.target.value) })} />
              </label>
              <span className="custom-row">
                {!isTextLayer(selected) && (
                  <>
                    <Button className="button ghost compact" type="button" title="铺满这一面，超出的部分裁掉" onClick={() => updateLayer(selected.id, fitLayer(selected.width, selected.height, 'cover'))}>
                      <Maximize size={13} />
                      铺满
                    </Button>
                    <Button className="button ghost compact" type="button" title="完整显示整张图" onClick={() => updateLayer(selected.id, fitLayer(selected.width, selected.height, 'contain'))}>
                      <Minimize size={13} />
                      完整显示
                    </Button>
                  </>
                )}
                <Button className="icon-button compact-icon" type="button" aria-label="逆时针转 90°" title="逆时针转 90°" onClick={() => updateLayer(selected.id, { rotation: selected.rotation - 90 })}>
                  <RotateCcw size={14} />
                </Button>
                <Button className="icon-button compact-icon" type="button" aria-label="顺时针转 90°" title="顺时针转 90°" onClick={() => updateLayer(selected.id, { rotation: selected.rotation + 90 })}>
                  <RotateCw size={14} />
                </Button>
                <Button className="icon-button compact-icon" type="button" aria-label="上移一层" title="上移一层" onClick={() => moveLayer(1)}>
                  <ArrowUp size={14} />
                </Button>
                <Button className="icon-button compact-icon" type="button" aria-label="下移一层" title="下移一层" onClick={() => moveLayer(-1)}>
                  <ArrowDown size={14} />
                </Button>
                <Button
                  className="icon-button compact-icon"
                  type="button"
                  aria-label={isTextLayer(selected) ? '删除这段文字' : '删除这张图'}
                  title={isTextLayer(selected) ? '删除这段文字' : '删除这张图'}
                  onClick={() => {
                    updateFace(editing, (current) => ({ ...current, layers: current.layers.filter((layer) => layer.id !== selected.id) }));
                    setSelectedId('');
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </span>
            </div>
          )}
          {selected && !isTextLayer(selected) && (
            <RetouchPanel
              disabled={Boolean(busy) || Boolean(retouch) || Boolean(photoEdit) || Boolean(pending)}
              busy={busy}
              canUndo={Boolean(retouchHistory.get(selected.id)?.length)}
              onCrop={() => void startRetouch('crop')}
              onPerspective={() => void startRetouch('perspective')}
              onLocal={(kind, custom) => void startRetouch('mask', { kind, custom })}
              onOutpaint={(extra) => void runOutpaint(extra)}
              onRestore={runRestore}
              onUpscale={(model) => void runUpscale(model)}
              onUndo={() => undoRetouch(selected.id)}
              progress={upscaleProgress}
            />
          )}
        </aside>

        {pending ? (
          <RetouchCompare
            before={pending.before}
            after={pending.after}
            note={pending.note}
            onReject={closePending}
            onAccept={() =>
              void run('retouch', async () => {
                await applyRetouch(pending.layerId, pending.result.bytes, pending.result.ext, pending.refit);
                closePending();
              })
            }
          />
        ) : retouch ? (
          <section className="canvas-stage custom-stage" aria-label="修图">
            <ReferenceEditor
              reference={{ fileName: '', title: '买家的图', dataUrl: retouch.dataUrl }}
              position={1}
              initialMode={retouch.mode}
              modes={retouch.local ? ['mask'] : ['crop', 'perspective']}
              heading={retouch.local ? 'AI 局部修改' : '修图'}
              saveLabel={retouch.local ? (busy === 'local' ? 'AI 处理中…' : '开始修改') : undefined}
              maskHint="把要改的地方涂满（比整块水印、缺口稍大一圈）。只有涂过的地方会换成 AI 画的，其余像素保持原图。"
              onCancel={() => setRetouch(null)}
              onSave={(next) => {
                const { local, layerId } = retouch;
                if (busy) return;
                if (!local) {
                  void run('retouch', async () => {
                    const { bytes, ext } = bytesOf(next.dataUrl);
                    await applyRetouch(layerId, bytes, ext, true);
                    setRetouch(null);
                  });
                  return;
                }
                void run('local', async () => {
                  if (!next.maskDataUrl) throw new Error('先在图上涂要改的地方');
                  const { source } = selectedSource();
                  const result = await localEdit(aiEdit!, source.bitmap, { marked: next.dataUrl, mask: next.maskDataUrl, color: next.maskColor ?? '#00ff00', kind: local.kind, custom: local.custom });
                  setRetouch(null);
                  await showResult(layerId, source, result, false, '只有涂过的地方换成了 AI 画的，其余像素和原图一样。');
                });
              }}
            />
          </section>
        ) : photoEdit ? (
          <section className="canvas-stage custom-stage" aria-label="用图片做样机">
            <div className="custom-stage-head">
              <strong>用图片做样机</strong>
              <span className="custom-row">
                <Button className="button ghost compact" type="button" onClick={() => setPhotoEdit({ ...photoEdit, mesh: defaultMesh(photoEdit.bitmap.width, photoEdit.bitmap.height) })}>
                  重置网格
                </Button>
                <Button className="button ghost compact" type="button" onClick={closePhotoTemplate}>
                  取消
                </Button>
                <Button className="button primary compact" type="button" disabled={busy === 'photo'} onClick={() => void savePhotoTemplate()}>
                  {busy === 'photo' ? '保存中…' : '保存样机'}
                </Button>
              </span>
            </div>
            <MeshEditor url={photoEdit.url} width={photoEdit.bitmap.width} height={photoEdit.bitmap.height} mesh={photoEdit.mesh} onChange={(mesh) => setPhotoEdit({ ...photoEdit, mesh })} />
            <p className="nas-form-note">拖四个角和四条边上的点，把网格对准产品的轮廓；边往外拱就是产品鼓起来的地方，中间的点会自动跟着弯。右边是实时效果。</p>
          </section>
        ) : (
        <section className="canvas-stage custom-stage" aria-label="排版">
          <div className="custom-stage-head">
            {layout?.facesMode === 'different' ? (
              <div className="canvas-segmented" role="radiogroup" aria-label="正在排的面">
                {(['front', 'back'] as const).map((target) => (
                  <button key={target} type="button" role="radio" aria-checked={editing === target} className={editing === target ? 'is-active' : ''} onClick={() => setEditing(target)}>
                    {target === 'front' ? '正面' : '背面'}
                  </button>
                ))}
              </div>
            ) : (
              <strong>{layout ? `${layout.sizeCm}×${layout.sizeCm}cm` : '排版'}</strong>
            )}
            <span className="custom-row">
              <Button className="button ghost compact" type="button" disabled={!layout} onClick={() => fileInput.current?.click()}>
                <ImagePlus size={13} />
                放图
              </Button>
              <Button className="button ghost compact" type="button" disabled={!layout} onClick={addText}>
                <Type size={13} />
                加文字
              </Button>
              {assets?.sample && face && face.layers.length === 0 && (
                <Button className="button ghost compact" type="button" onClick={() => void addImages([{ name: 'sample.jpg', type: 'image/jpeg', bytes: assets.sample! }])}>
                  用示例图预览
                </Button>
              )}
            </span>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => void addFileList(event.target.files).then(() => (event.target.value = ''))} />
          </div>
          {layout ? (
            <div
              className="custom-stage-frame"
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={() => (drag.current = null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void addFileList(event.dataTransfer.files);
              }}
            >
              <canvas ref={stageCanvas} />
              <div className="custom-bleed" style={{ inset: `${bleedPercent}%` }} aria-hidden="true" />
              {face && face.layers.length === 0 && <p className="custom-stage-hint">把买家的图拖到这里，或点「放图」</p>}
            </div>
          ) : (
            <p className="nas-form-note">先在左边选一个产品。</p>
          )}
          {lowResLayers.length > 0 && (
            <p className="custom-warning" role="status">
              <TriangleAlert size={14} aria-hidden="true" />
              原图偏小：按现在的大小印出来约 {Math.min(...lowResLayers)}dpi，可能模糊（建议不低于 {LOW_DPI}dpi）。换一张清晰的原图，或者把图缩小一些。
            </p>
          )}
          <p className="nas-form-note">虚线以外是出血位，裁切时可能被切掉：背景铺满到边，文字、人脸放在虚线以内。</p>
        </section>
        )}

        <aside className="canvas-panel custom-preview" aria-label="效果图">
          <div className="canvas-panel-head">
            <strong>{photoEdit ? '样机预览' : '效果图'}</strong>
          </div>
          {product?.template || photoEdit ? <canvas ref={mockupCanvas} className="custom-mockup" /> : <p className="nas-form-note">这个产品还没有样机，在左边「产品设置」里导入样机 PSD，或者用图片做样机。</p>}
          {layout && !photoEdit && product?.template && <p className="nas-form-note">复制和保存的就是这张正反面对照图。</p>}
          <div className="custom-actions">
            <Button className="button primary" type="button" disabled={!product?.template || !face?.layers.length || Boolean(busy) || Boolean(photoEdit)} onClick={() => void copyEffect()}>
              <Copy size={14} />
              复制正反面对照图
            </Button>
            <Button className="button ghost" type="button" disabled={!product?.template || !face?.layers.length || Boolean(busy) || Boolean(photoEdit)} onClick={() => void saveVersion()}>
              <Save size={14} />
              {busy === 'save' ? '保存中…' : '保存这一版'}
            </Button>
            <Button className="button ghost" type="button" disabled={!face?.layers.length || Boolean(busy)} onClick={() => void exportProduction()}>
              <Download size={14} />
              {busy === 'export' ? '生成中…' : `导出生产图${layout ? `（${layout.sizeCm}cm）` : ''}`}
            </Button>
          </div>
        </aside>
      </div>
    </main>
  );
}
