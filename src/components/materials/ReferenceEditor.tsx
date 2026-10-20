// 画布参考图：全图预览，以及在中间「生成记录」区域里编辑（裁剪、透视裁剪、局部重绘遮罩）。不开新窗口，编辑完换掉原图回到生成记录。
// 局部重绘照 ComfyUI 的 Draw Mask On Image：涂过的地方用实色绿 (0,255,0) 画进提交的图里，另存一张遮罩 PNG（涂过的地方透明）给 /images/edits 的 mask 字段。
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Brush, ChevronLeft, ChevronRight, Eraser, PaintBucket, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '../ui/button';
import type { CanvasReference } from '../../materials/canvasStore';
import {
  applyHomography,
  centeredCrop,
  cropFromAnchor,
  dragCrop,
  isConvexQuad,
  moveCrop,
  perspectiveOutputSize,
  pixelCrop,
  solveHomography,
  warpPerspective,
  type CropHandle,
  type Point,
  type Quad,
  type Rect,
} from '../../materials/imageEdit';
import { canvasAspectRatioOptions } from '../../materials/suyan/canvasGeneration.ts';

export type EditorMode = 'crop' | 'perspective' | 'mask';

const MODES: Array<{ value: EditorMode; label: string }> = [
  { value: 'crop', label: '裁剪' },
  { value: 'perspective', label: '透视裁剪' },
  { value: 'mask', label: '局部重绘' },
];
const RATIOS = [{ value: '', label: '自由' }, ...canvasAspectRatioOptions.map(({ value, label }) => ({ value: value as string, label }))];
// 局部重绘的标记颜色：默认实色绿（照 ComfyUI Draw Mask On Image）；换颜色时整层一起换，提示词里写「X色标记区域」。
const MASK_COLORS = [
  { value: '#00ff00', label: '绿色' },
  { value: '#ff0000', label: '红色' },
  { value: '#0000ff', label: '蓝色' },
  { value: '#ffff00', label: '黄色' },
  { value: '#ff00ff', label: '品红' },
  { value: '#00ffff', label: '青色' },
  { value: '#ffffff', label: '白色' },
  { value: '#000000', label: '黑色' },
];
const PREVIEW_SIZE = 240;
const CORNER_HANDLES: CropHandle[] = ['nw', 'ne', 'se', 'sw'];
const EDGE_HANDLES: CropHandle[] = ['n', 'e', 's', 'w'];
const EDGE_ROOM = 12;

const ratioValue = (value: string) => {
  const [width, height] = value.split(':').map(Number);
  return width && height ? width / height : null;
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读不出来'));
    image.src = src;
  });

const makeCanvas = (width: number, height: number) => {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return { element, context: element.getContext('2d')! };
};

// 手柄在框上的位置
const handlePoint = (rect: Rect, handle: CropHandle): Point => ({
  x: handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.w : rect.x + rect.w / 2,
  y: handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.h : rect.y + rect.h / 2,
});

type Drag = { kind: 'move' | 'new' | CropHandle; start: Point; startClient: Point; rect: Rect } | { kind: 'corner'; index: number } | { kind: 'paint'; last: Point };

type ReferenceEditorProps = {
  reference: CanvasReference;
  position: number;
  initialMode: EditorMode;
  onSave: (next: CanvasReference) => void;
  onCancel: () => void;
};

export function ReferenceEditor({ reference, position, initialMode, onSave, onCancel }: ReferenceEditorProps) {
  // 编辑一律从没涂过的原图开始；已有的遮罩放回遮罩层接着涂。
  const source = reference.sourceDataUrl ?? reference.dataUrl;
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState(initialMode);
  const [ratio, setRatio] = useState('');
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [quad, setQuad] = useState<Quad>([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState(40);
  // 遮罩层一直按不透明的颜色画，透明度只在显示和合成提交的图时用：笔画重叠不会越涂越深，给接口的遮罩也还是「涂过 = 透明」。
  const [maskColor, setMaskColor] = useState(reference.maskColor ?? MASK_COLORS[0].value);
  const [maskOpacity, setMaskOpacity] = useState(reference.maskOpacity ?? 100);
  const [canUndo, setCanUndo] = useState(false);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const undoRef = useRef<ImageData | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const width = image?.naturalWidth ?? 1;
  const height = image?.naturalHeight ?? 1;

  useEffect(() => {
    let alive = true;
    loadImage(source).then(
      (loaded) => {
        if (!alive) return;
        const w = loaded.naturalWidth;
        const h = loaded.naturalHeight;
        const inset = Math.min(w, h) * 0.08;
        setCrop({ x: 0, y: 0, w, h });
        setQuad([{ x: inset, y: inset }, { x: w - inset, y: inset }, { x: w - inset, y: h - inset }, { x: inset, y: h - inset }]);
        setImage(loaded);
      },
      () => alive && setLoadError('这张参考图读不出来，没法编辑'),
    );
    return () => {
      alive = false;
    };
  }, [source]);

  // 遮罩层和原图一样大（按原图像素画），已有遮罩时把「透明 = 涂过」换回绿色。
  useEffect(() => {
    const canvasElement = maskRef.current;
    if (!image || !canvasElement) return;
    canvasElement.width = image.naturalWidth;
    canvasElement.height = image.naturalHeight;
    if (!reference.maskDataUrl) return;
    void loadImage(reference.maskDataUrl).then((mask) => {
      const context = canvasElement.getContext('2d')!;
      context.fillStyle = maskColor;
      context.fillRect(0, 0, canvasElement.width, canvasElement.height);
      context.globalCompositeOperation = 'destination-out';
      context.drawImage(mask, 0, 0, canvasElement.width, canvasElement.height);
      context.globalCompositeOperation = 'source-over';
    });
  }, [image, reference.maskDataUrl]);

  // 图按比例放进编辑区，窗口变了跟着变。
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !image) return;
    const fit = () => {
      // 四周留出 EDGE_ROOM，贴边的手柄也能整个露出来、抓得到
      const scale = Math.min((box.clientWidth - EDGE_ROOM * 2) / image.naturalWidth, (box.clientHeight - EDGE_ROOM * 2) / image.naturalHeight);
      setFrame({ w: Math.floor(image.naturalWidth * scale), h: Math.floor(image.naturalHeight * scale) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [image]);

  const toImage = (event: { clientX: number; clientY: number }): Point => {
    const rect = frameRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) * width) / rect.width, y: ((event.clientY - rect.top) * height) / rect.height };
  };
  // 屏幕上一个像素等于原图几个像素：手柄、笔刷按屏幕大小算。
  const unit = frame.w ? width / frame.w : 1;
  const lockedRatio = ratioValue(ratio);

  const changeRatio = (value: string) => {
    setRatio(value);
    setCrop(centeredCrop(ratioValue(value), width, height));
  };

  const onOverlayDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target as Element;
    event.currentTarget.setPointerCapture(event.pointerId);
    const corner = target.getAttribute('data-corner');
    if (corner !== null) {
      dragRef.current = { kind: 'corner', index: Number(corner) };
      return;
    }
    const handle = (target.getAttribute('data-handle') as 'move' | CropHandle | null) ?? 'new';
    dragRef.current = { kind: handle, start: toImage(event), startClient: { x: event.clientX, y: event.clientY }, rect: crop };
  };

  const onOverlayMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.kind === 'paint') return;
    const point = toImage(event);
    if (drag.kind === 'corner') {
      const clamped = { x: Math.min(width, Math.max(0, point.x)), y: Math.min(height, Math.max(0, point.y)) };
      setQuad((current) => current.map((entry, index) => (index === drag.index ? clamped : entry)) as Quad);
    } else if (drag.kind === 'move') {
      setCrop(moveCrop(drag.rect, point.x - drag.start.x, point.y - drag.start.y, width, height));
    } else if (drag.kind === 'new') {
      // 点一下不算，拖开几个像素才重新拉框，免得误点把框弄没了。
      if (Math.hypot(event.clientX - drag.startClient.x, event.clientY - drag.startClient.y) < 4) return;
      setCrop(cropFromAnchor(drag.start, point, lockedRatio, width, height));
    } else {
      setCrop(dragCrop(drag.rect, drag.kind, point, lockedRatio, width, height));
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const maskContext = () => maskRef.current!.getContext('2d')!;
  const snapshot = () => {
    undoRef.current = maskContext().getImageData(0, 0, width, height);
    setCanUndo(true);
  };

  const onMaskDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    snapshot();
    const context = maskContext();
    const point = toImage(event);
    const lineWidth = brushSize * unit;
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.fillStyle = maskColor;
    context.strokeStyle = maskColor;
    context.lineWidth = lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.arc(point.x, point.y, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    dragRef.current = { kind: 'paint', last: point };
  };

  const onMaskMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.kind !== 'paint') return;
    const point = toImage(event);
    const context = maskContext();
    context.beginPath();
    context.moveTo(drag.last.x, drag.last.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    drag.last = point;
  };

  const fillMask = (fill: boolean) => {
    snapshot();
    const context = maskContext();
    context.globalCompositeOperation = 'source-over';
    if (fill) {
      context.fillStyle = maskColor;
      context.fillRect(0, 0, width, height);
    } else {
      context.clearRect(0, 0, width, height);
    }
  };

  // 换颜色：已经涂过的地方一起换成新颜色，整层只有一种颜色。
  const changeMaskColor = (color: string) => {
    setMaskColor(color);
    if (!maskRef.current) return;
    const context = maskContext();
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
  };

  // 裁剪时右侧实时画出裁剪后的样子，按比例缩进预览框。
  const cropPixels = image ? pixelCrop(crop, width, height) : null;
  const previewScale = cropPixels ? Math.min(PREVIEW_SIZE / cropPixels.w, PREVIEW_SIZE / cropPixels.h) : 1;
  useEffect(() => {
    const element = previewRef.current;
    if (!element || !image || !cropPixels || mode !== 'crop') return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.max(1, Math.round(cropPixels.w * previewScale * ratio));
    element.height = Math.max(1, Math.round(cropPixels.h * previewScale * ratio));
    const context = element.getContext('2d')!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, cropPixels.x, cropPixels.y, cropPixels.w, cropPixels.h, 0, 0, element.width, element.height);
  }, [image, mode, cropPixels?.x, cropPixels?.y, cropPixels?.w, cropPixels?.h]);

  const undo = () => {
    if (!undoRef.current) return;
    maskContext().putImageData(undoRef.current, 0, 0);
    undoRef.current = null;
    setCanUndo(false);
  };

  // 输出格式跟原图：JPEG 还存 JPEG，其余存 PNG。
  const encode = (element: HTMLCanvasElement) => (source.startsWith('data:image/jpeg') ? element.toDataURL('image/jpeg', 0.92) : element.toDataURL('image/png'));
  const plain = (dataUrl: string): CanvasReference => ({ fileName: '', title: reference.title, dataUrl });

  const save = async () => {
    if (!image) return;
    setError('');
    if (mode === 'crop') {
      const rect = pixelCrop(crop, width, height);
      const { element, context } = makeCanvas(rect.w, rect.h);
      context.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      onSave(plain(encode(element)));
      return;
    }
    if (mode === 'perspective') {
      if (!isConvexQuad(quad)) {
        setError('四个角拖交叉了，按左上、右上、右下、左下的顺序摆好再保存');
        return;
      }
      setSaving(true);
      // 让「正在处理」先显示出来，大图逐像素重采样要一两秒。
      await new Promise((resolve) => setTimeout(resolve, 30));
      const input = makeCanvas(width, height);
      input.context.drawImage(image, 0, 0);
      const size = perspectiveOutputSize(quad);
      const output = makeCanvas(size.width, size.height);
      const pixels = warpPerspective(input.context.getImageData(0, 0, width, height), quad, size.width, size.height);
      output.context.putImageData(new ImageData(pixels, size.width, size.height), 0, 0);
      setSaving(false);
      onSave(plain(encode(output.element)));
      return;
    }
    const maskCanvas = maskRef.current!;
    const alpha = maskContext().getImageData(0, 0, width, height).data;
    let painted = false;
    for (let index = 3; index < alpha.length; index += 4) {
      if (alpha[index]) {
        painted = true;
        break;
      }
    }
    // 什么都没涂：去掉遮罩，换回原图。
    if (!painted) {
      onSave(plain(source));
      return;
    }
    const marked = makeCanvas(width, height);
    marked.context.drawImage(image, 0, 0);
    marked.context.globalAlpha = maskOpacity / 100;
    marked.context.drawImage(maskCanvas, 0, 0);
    marked.context.globalAlpha = 1;
    const mask = makeCanvas(width, height);
    mask.context.fillStyle = '#fff';
    mask.context.fillRect(0, 0, width, height);
    mask.context.globalCompositeOperation = 'destination-out';
    mask.context.drawImage(maskCanvas, 0, 0);
    onSave({ fileName: '', title: reference.title, dataUrl: encode(marked.element), sourceDataUrl: source, maskDataUrl: mask.element.toDataURL('image/png'), maskColor, maskOpacity });
  };

  const shownHandles = lockedRatio ? CORNER_HANDLES : [...CORNER_HANDLES, ...EDGE_HANDLES];
  const handleSize = 12 * unit;
  let grid: Array<[Point, Point]> = [];
  try {
    const h = solveHomography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], quad);
    grid = [1 / 3, 2 / 3].flatMap((t) => [
      [applyHomography(h, t, 0), applyHomography(h, t, 1)] as [Point, Point],
      [applyHomography(h, 0, t), applyHomography(h, 1, t)] as [Point, Point],
    ]);
  } catch {
    // 四个角挤成一条线时不画网格
  }
  const colorName = MASK_COLORS.find((entry) => entry.value === maskColor.toLowerCase())?.label ?? '所选颜色的';
  const hints: Record<EditorMode, string> = {
    crop: '拖框边或四角调整，拖框内移动，在框外拖动重新框选。',
    perspective: '把四个角拖到要拉正的区域（比如斜着拍的屏幕、海报），保存后拉成正视的矩形；网格帮助对齐。',
    mask: `在要重绘的地方涂抹，涂满整张就是整图重绘。提交时涂过的地方会按现在看到的颜色和透明度画进这张参考图，提示词里写「${colorName}标记区域…」；OpenAI 兼容接口还会同时收到遮罩，Grok、Agnes 只看${colorName}标记。`,
  };

  return (
    <div className="ref-editor">
      <div className="ref-editor-head">
        <div className="ref-editor-title">
          <strong>编辑参考图</strong>
          <span>
            第 {position} 张 · {reference.title}
            {image ? ` · ${width}×${height}` : ''}
          </span>
        </div>
        <div className="canvas-segmented" role="radiogroup" aria-label="编辑方式">
          {MODES.map((option) => (
            <button key={option.value} type="button" role="radio" aria-checked={mode === option.value} className={mode === option.value ? 'is-active' : ''} onClick={() => setMode(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
        <span className="ref-editor-spacer" />
        <Button className="button ghost compact" type="button" onClick={onCancel}>
          取消
        </Button>
        <Button className="button primary compact" type="button" disabled={!image || saving} onClick={() => void save()}>
          {saving ? '正在处理…' : '保存并返回'}
        </Button>
      </div>

      <div className="ref-editor-tools">
        {mode === 'crop' && (
          <div className="canvas-template-chips" role="radiogroup" aria-label="裁剪比例">
            {RATIOS.map((option) => (
              <button key={option.label} type="button" role="radio" aria-checked={ratio === option.value} className={ratio === option.value ? 'is-active' : ''} onClick={() => changeRatio(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        )}
        {mode === 'perspective' && (
          <Button
            className="button ghost compact"
            type="button"
            onClick={() => setQuad([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }])}
          >
            四角放回整张图
          </Button>
        )}
        {mode === 'mask' && (
          <>
            <div className="canvas-segmented" role="radiogroup" aria-label="笔刷工具">
              <button type="button" role="radio" aria-checked={tool === 'brush'} className={tool === 'brush' ? 'is-active' : ''} onClick={() => setTool('brush')}>
                <Brush size={13} /> 笔刷
              </button>
              <button type="button" role="radio" aria-checked={tool === 'eraser'} className={tool === 'eraser' ? 'is-active' : ''} onClick={() => setTool('eraser')}>
                <Eraser size={13} /> 橡皮
              </button>
            </div>
            <label className="ref-editor-size">
              大小
              <input type="range" min={4} max={200} value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
              <span>{brushSize}px</span>
            </label>
            <div className="ref-editor-swatches" role="radiogroup" aria-label="笔刷颜色">
              {MASK_COLORS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  role="radio"
                  aria-checked={maskColor === entry.value}
                  aria-label={entry.label}
                  title={entry.label}
                  className={maskColor === entry.value ? 'is-active' : ''}
                  style={{ background: entry.value }}
                  onClick={() => changeMaskColor(entry.value)}
                />
              ))}
              <input type="color" value={maskColor} aria-label="自定义颜色" title="自定义颜色" onChange={(event) => changeMaskColor(event.target.value)} />
            </div>
            <label className="ref-editor-size">
              透明度
              <input type="range" min={10} max={100} step={5} value={maskOpacity} onChange={(event) => setMaskOpacity(Number(event.target.value))} />
              <span>{maskOpacity}%</span>
            </label>
            <Button className="button ghost compact" type="button" disabled={!canUndo} onClick={undo} title="撤销上一笔">
              <Undo2 size={13} />
              撤销
            </Button>
            <Button className="button ghost compact" type="button" onClick={() => fillMask(true)} title="整张图都重绘">
              <PaintBucket size={13} />
              涂满整图
            </Button>
            <Button className="button ghost compact" type="button" onClick={() => fillMask(false)}>
              <Trash2 size={13} />
              清空
            </Button>
          </>
        )}
      </div>

      <div className={`ref-editor-body ${mode === 'crop' ? 'has-preview' : ''}`}>
      <div className="ref-editor-canvas" ref={boxRef}>
        {loadError ? (
          <p className="canvas-media-missing">{loadError}</p>
        ) : (
          image && (
            <div className="ref-editor-frame" ref={frameRef} style={{ width: frame.w, height: frame.h }}>
              <img src={source} alt="" draggable={false} />
              <canvas
                ref={maskRef}
                className={`ref-editor-mask ${mode === 'mask' ? '' : 'is-hidden'}`}
                style={{ opacity: maskOpacity / 100 }}
                aria-label="遮罩：在图上涂抹要重绘的区域"
                onPointerDown={onMaskDown}
                onPointerMove={onMaskMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
              {mode !== 'mask' && (
                <svg
                  className="ref-editor-overlay"
                  viewBox={`0 0 ${width} ${height}`}
                  preserveAspectRatio="none"
                  onPointerDown={onOverlayDown}
                  onPointerMove={onOverlayMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  {mode === 'crop' ? (
                    <>
                      <path className="ref-editor-shade" fillRule="evenodd" d={`M0 0H${width}V${height}H0Z M${crop.x} ${crop.y}h${crop.w}v${crop.h}h${-crop.w}Z`} />
                      <rect data-handle="move" className="ref-editor-box" x={crop.x} y={crop.y} width={crop.w} height={crop.h} />
                      {[1 / 3, 2 / 3].map((t) => (
                        <g key={t} className="ref-editor-guide">
                          <line x1={crop.x + crop.w * t} y1={crop.y} x2={crop.x + crop.w * t} y2={crop.y + crop.h} />
                          <line x1={crop.x} y1={crop.y + crop.h * t} x2={crop.x + crop.w} y2={crop.y + crop.h * t} />
                        </g>
                      ))}
                      {shownHandles.map((handle) => {
                        const point = handlePoint(crop, handle);
                        return <rect key={handle} data-handle={handle} className="ref-editor-handle" x={point.x - handleSize / 2} y={point.y - handleSize / 2} width={handleSize} height={handleSize} />;
                      })}
                    </>
                  ) : (
                    <>
                      <path className="ref-editor-shade" fillRule="evenodd" d={`M0 0H${width}V${height}H0Z M${quad.map((point) => `${point.x} ${point.y}`).join('L')}Z`} />
                      <polygon className="ref-editor-box is-static" points={quad.map((point) => `${point.x},${point.y}`).join(' ')} />
                      {grid.map(([from, to], index) => (
                        <line key={index} className="ref-editor-guide" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                      ))}
                      {quad.map((point, index) => (
                        <ellipse key={index} data-corner={index} className="ref-editor-corner" cx={point.x} cy={point.y} rx={handleSize * 0.7} ry={handleSize * 0.7} />
                      ))}
                    </>
                  )}
                </svg>
              )}
            </div>
          )
        )}
      </div>
      {mode === 'crop' && image && cropPixels && (
        <aside className="ref-editor-preview" aria-label="裁剪后预览">
          <strong>裁剪后预览</strong>
          <canvas ref={previewRef} />
          <span>
            {cropPixels.w}×{cropPixels.h}
          </span>
        </aside>
      )}
      </div>

      <p className={error ? 'canvas-detail-error' : 'nas-form-note'} role={error ? 'alert' : undefined}>
        {error ||
          (reference.maskDataUrl && mode !== 'mask' ? `这张已经涂过遮罩：${MODES.find((entry) => entry.value === mode)?.label}后遮罩会清掉，需要的话再涂。` : '') ||
          hints[mode]}
      </p>
    </div>
  );
}

type ReferencePreviewProps = {
  references: CanvasReference[];
  index: number;
  onChange: (index: number) => void;
  onEdit: (index: number) => void;
  onClose: () => void;
};

// 点参考图缩略图弹出的全图预览：Esc 关，左右方向键翻。
export function ReferencePreview({ references, index, onChange, onEdit, onClose }: ReferencePreviewProps) {
  const [size, setSize] = useState('');
  const reference = references[index];
  const go = (step: number) => onChange((index + step + references.length) % references.length);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') go(-1);
      else if (event.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!reference) return null;
  return (
    <div className="modal-shell reference-preview" role="dialog" aria-modal="true" aria-label="参考图预览">
      <Button className="modal-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      <div className="reference-preview-body">
        <div className="reference-preview-head">
          <span>
            第 {index + 1} / {references.length} 张 · {reference.title}
            {size ? ` · ${size}` : ''}
            {reference.maskDataUrl ? ' · 已涂遮罩' : ''}
          </span>
          {references.length > 1 && (
            <>
              <Button className="icon-button" type="button" aria-label="上一张" title="上一张（←）" onClick={() => go(-1)}>
                <ChevronLeft size={18} />
              </Button>
              <Button className="icon-button" type="button" aria-label="下一张" title="下一张（→）" onClick={() => go(1)}>
                <ChevronRight size={18} />
              </Button>
            </>
          )}
          <Button className="button ghost compact" type="button" onClick={() => onEdit(index)}>
            <Pencil size={13} />
            编辑
          </Button>
          {/* 打开时焦点移进弹窗：不然焦点还在缩略图上，按左右键会同时给参考图换顺序 */}
          <Button className="icon-button" type="button" aria-label="关闭" title="关闭（Esc）" autoFocus onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <div
          className="reference-preview-media"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <img
            key={index}
            src={reference.dataUrl}
            alt={reference.title}
            onLoad={(event) => setSize(`${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}`)}
          />
        </div>
      </div>
    </div>
  );
}
