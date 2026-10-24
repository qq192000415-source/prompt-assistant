import { useState } from 'react';
import { Brush, Crop, Expand, ImageUpscale, Sparkles, Undo2, Waypoints } from 'lucide-react';
import { Button } from '../ui/button';
import type { RetouchKind } from '../../custom/retouch';

// 选中图片下面的「修图」：裁剪、透视拉正、AI 局部修改在中间区域用画布的编辑器做；扩图、变清晰直接提交。
// AI 出的结果先在中间左右对照，点「用这张」才换进排版；每一步都能撤销（只在内存里）。
export type LocalKind = Extract<RetouchKind, 'watermark' | 'fill' | 'custom'>;
const LOCAL_KINDS: Array<{ value: LocalKind; label: string }> = [
  { value: 'watermark', label: '去水印' },
  { value: 'fill', label: '补画缺掉的部分' },
  { value: 'custom', label: '自己写' },
];

type Props = {
  disabled: boolean;
  busy: string;
  canUndo: boolean;
  onCrop: () => void;
  onPerspective: () => void;
  onLocal: (kind: LocalKind, custom: string) => void;
  onOutpaint: (extra: number) => void;
  onRestore: () => void;
  onUpscale: (model: 'photo' | 'anime') => void;
  onUndo: () => void;
  // 下载组件、放大时的进度说明。
  progress: string;
};

export function RetouchPanel({ disabled, busy, canUndo, onCrop, onPerspective, onLocal, onOutpaint, onRestore, onUpscale, onUndo, progress }: Props) {
  const [kind, setKind] = useState<LocalKind>('watermark');
  const [custom, setCustom] = useState('');
  const [extra, setExtra] = useState(10);
  const [model, setModel] = useState<'photo' | 'anime'>('photo');
  return (
    <div className="canvas-section custom-retouch custom-layer-tools" aria-label="修图">
      <span className="material-field-label">修图</span>
      <span className="custom-row">
        <Button className="button ghost compact" type="button" disabled={disabled} onClick={onCrop}>
          <Crop size={13} />
          裁剪
        </Button>
        <Button className="button ghost compact" type="button" disabled={disabled} title="斜着拍的照片、海报，拖四个角拉成正的" onClick={onPerspective}>
          <Waypoints size={13} />
          透视拉正
        </Button>
        <Button className="button ghost compact" type="button" disabled={disabled || !canUndo} title="退回上一步修图" onClick={onUndo}>
          <Undo2 size={13} />
          撤销修图
        </Button>
      </span>

      <span className="material-field-label">AI 局部修改</span>
      <div className="canvas-segmented" role="radiogroup" aria-label="AI 局部修改">
        {LOCAL_KINDS.map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={kind === option.value} className={kind === option.value ? 'is-active' : ''} onClick={() => setKind(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      {kind === 'custom' && <textarea rows={2} className="custom-textarea" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="比如：把背景换成纯白色" aria-label="要改成什么" />}
      <Button className="button ghost compact" type="button" disabled={disabled || (kind === 'custom' && !custom.trim())} onClick={() => onLocal(kind, custom)}>
        <Brush size={13} />
        涂抹要改的地方
      </Button>

      <label className="field">
        <span>扩成方形，四周再多扩 {extra}%</span>
        <input type="range" min={0} max={50} step={5} value={extra} onChange={(event) => setExtra(Number(event.target.value))} />
      </label>
      <span className="custom-row">
        <Button className="button ghost compact" type="button" disabled={disabled} title="图不是方形时，让 AI 把四周的背景补出来" onClick={() => onOutpaint(extra / 100)}>
          <Expand size={13} />
          {busy === 'outpaint' ? '扩图中…' : '扩成方形'}
        </Button>
        <Button className="button ghost compact" type="button" disabled={disabled} title="整张重画去掉模糊和噪点，人脸可能被改" onClick={onRestore}>
          <Sparkles size={13} />
          {busy === 'restore' ? '处理中…' : 'AI 变清晰'}
        </Button>
      </span>
      {['local', 'outpaint', 'restore'].includes(busy) && <p className="nas-form-note">AI 正在处理，一般要半分钟到两分钟。</p>}

      <span className="material-field-label">高清放大（放大 4 倍，在本机用显卡算，不花接口费用）</span>
      <div className="canvas-segmented" role="radiogroup" aria-label="放大模型">
        {(
          [
            ['photo', '照片'],
            ['anime', '插画、动漫'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={model === value} className={model === value ? 'is-active' : ''} onClick={() => setModel(value)}>
            {label}
          </button>
        ))}
      </div>
      <Button className="button ghost compact" type="button" disabled={disabled} onClick={() => onUpscale(model)}>
        <ImageUpscale size={13} />
        {busy === 'upscale' ? '放大中…' : '高清放大'}
      </Button>
      {busy === 'upscale' && progress && <p className="nas-form-note">{progress}</p>}
    </div>
  );
}

// AI 结果左右对照：用这张 / 不要。
export function RetouchCompare({ before, after, note, onAccept, onReject }: { before: string; after: string; note: string; onAccept: () => void; onReject: () => void }) {
  return (
    <section className="canvas-stage custom-stage" aria-label="核对 AI 修图结果">
      <div className="custom-stage-head">
        <strong>核对 AI 修图结果</strong>
        <span className="custom-row">
          <Button className="button ghost compact" type="button" onClick={onReject}>
            不要
          </Button>
          <Button className="button primary compact" type="button" onClick={onAccept}>
            用这张
          </Button>
        </span>
      </div>
      <div className="custom-compare">
        <figure>
          <img src={before} alt="修图前" />
          <figcaption>修图前</figcaption>
        </figure>
        <figure>
          <img src={after} alt="修图后" />
          <figcaption>修图后</figcaption>
        </figure>
      </div>
      <p className="nas-form-note">{note}</p>
    </section>
  );
}
