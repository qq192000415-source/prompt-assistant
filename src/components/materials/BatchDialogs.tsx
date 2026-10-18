import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '../ui/button';

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
}

function DialogFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="batch-dialog-title">
      <Button className="modal-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      <section className="editor-panel category-editor-panel">
        <div className="editor-header">
          <h2 id="batch-dialog-title">{title}</h2>
          <Button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}

type CompressImagesDialogProps = {
  count: number;
  onClose: () => void;
  onConfirm: (options: MaterialImageCompressOptions) => void;
};

export function CompressImagesDialog({ count, onClose, onConfirm }: CompressImagesDialogProps) {
  const [quality, setQuality] = useState(82);
  const [maxSide, setMaxSide] = useState(0);
  const [format, setFormat] = useState<MaterialImageCompressOptions['format']>('keep');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm({ quality, maxSide, format });
  };

  return (
    <DialogFrame title={`压缩 ${count} 张图片`} onClose={onClose}>
      <form className="batch-form" onSubmit={submit}>
        <label className="field">
          <span className="batch-field-label">
            JPG 质量 <strong>{quality}</strong>
          </span>
          <input type="range" min={50} max={95} step={1} value={quality} onChange={(event) => setQuality(Number(event.target.value))} />
        </label>
        <label className="field">
          最长边
          <select value={maxSide} onChange={(event) => setMaxSide(Number(event.target.value))}>
            <option value={0}>不缩小</option>
            <option value={3840}>3840 像素（4K）</option>
            <option value={2560}>2560 像素</option>
            <option value={1920}>1920 像素</option>
          </select>
        </label>
        <label className="field">
          PNG 图片
          <select value={format} onChange={(event) => setFormat(event.target.value as MaterialImageCompressOptions['format'])}>
            <option value="keep">保持 PNG（只在缩小尺寸时变小）</option>
            <option value="jpeg">转成 JPG（体积小很多，透明背景会变黑）</option>
          </select>
        </label>
        <p className="batch-note">只处理 JPG 和 PNG。压缩后没有变小的保持原样。原文件会被替换，不能恢复。</p>
        <div className="batch-actions">
          <Button className="button ghost" type="button" onClick={onClose}>
            取消
          </Button>
          <Button className="button primary" type="submit">
            开始压缩
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

type CompressVideosDialogProps = {
  count: number;
  ffmpegStatus: () => Promise<{ installed: boolean; downloadBytes: number }>;
  onInstallFfmpeg: () => Promise<boolean>;
  onClose: () => void;
  onConfirm: (options: MaterialVideoCompressOptions) => void;
};

const qualityPresets = [
  { crf: 23, label: '高画质（体积减少较少）' },
  { crf: 28, label: '均衡' },
  { crf: 32, label: '小体积（画质下降明显）' },
];

export function CompressVideosDialog({ count, ffmpegStatus, onInstallFfmpeg, onClose, onConfirm }: CompressVideosDialogProps) {
  const [ffmpeg, setFfmpeg] = useState<{ installed: boolean; downloadBytes: number } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [resolution, setResolution] = useState<MaterialVideoCompressOptions['resolution']>('1080p');
  const [crf, setCrf] = useState(28);
  const [codec, setCodec] = useState<MaterialVideoCompressOptions['codec']>('h264');

  // 只在打开时查一次：ffmpegStatus 每次渲染都是新函数，放进依赖会反复查询。
  useEffect(() => {
    void ffmpegStatus().then(setFfmpeg);
  }, []);

  const install = async () => {
    setInstalling(true);
    const done = await onInstallFfmpeg();
    setInstalling(false);
    if (done) setFfmpeg(await ffmpegStatus());
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm({ resolution, crf, codec });
  };

  return (
    <DialogFrame title={`压缩 ${count} 个视频`} onClose={onClose}>
      {ffmpeg && !ffmpeg.installed ? (
        <div className="batch-form">
          <p className="batch-note">
            压缩视频要用 FFmpeg，第一次使用需要下载一次（约 {Math.round(ffmpeg.downloadBytes / 1024 / 1024)} MB），从本软件的更新服务器下载，下载后会校验文件完整性。
          </p>
          <div className="batch-actions">
            <Button className="button ghost" type="button" onClick={onClose}>
              取消
            </Button>
            <Button className="button primary" type="button" disabled={installing} onClick={() => void install()}>
              <Download size={15} />
              {installing ? '正在下载…' : '下载 FFmpeg'}
            </Button>
          </div>
        </div>
      ) : (
        <form className="batch-form" onSubmit={submit}>
          <label className="field">
            分辨率
            <select value={resolution} onChange={(event) => setResolution(event.target.value as MaterialVideoCompressOptions['resolution'])}>
              <option value="original">保持原分辨率</option>
              <option value="1080p">最高 1080p</option>
              <option value="720p">最高 720p</option>
              <option value="480p">最高 480p</option>
            </select>
          </label>
          <label className="field">
            画质
            <select value={crf} onChange={(event) => setCrf(Number(event.target.value))}>
              {qualityPresets.map((preset) => (
                <option key={preset.crf} value={preset.crf}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            编码
            <select value={codec} onChange={(event) => setCodec(event.target.value as MaterialVideoCompressOptions['codec'])}>
              <option value="h264">H.264（兼容性最好）</option>
              <option value="h265">H.265（更小，部分老设备播放不了）</option>
            </select>
          </label>
          <p className="batch-note">
            输出为 MP4。有 NVIDIA、Intel、AMD 显卡编码器时会优先使用，速度快很多。视频要先从 NAS 下载到本机临时文件夹，处理完立即删除。原文件会被替换，不能恢复。
          </p>
          <div className="batch-actions">
            <Button className="button ghost" type="button" onClick={onClose}>
              取消
            </Button>
            <Button className="button primary" type="submit" disabled={!ffmpeg}>
              开始压缩
            </Button>
          </div>
        </form>
      )}
    </DialogFrame>
  );
}

type BatchProgressPanelProps = {
  progress: MaterialBatchProgress;
  onCancel: () => void;
};

export function BatchProgressPanel({ progress, onCancel }: BatchProgressPanelProps) {
  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const countText =
    progress.total <= 0
      ? ''
      : progress.task === '下载 FFmpeg'
        ? `${(progress.done / 1024 / 1024).toFixed(0)} / ${(progress.total / 1024 / 1024).toFixed(0)} MB`
        : `${Math.min(progress.total, Math.floor(progress.done) + 1)} / ${progress.total}`;
  return (
    <div className="materials-progress" role="status" aria-live="polite">
      <div className="materials-progress-head">
        <strong>{progress.task}</strong>
        <span>{countText}</span>
        {progress.task !== '下载 FFmpeg' && (
          <Button className="button ghost compact" type="button" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
      <div className="materials-progress-track" aria-hidden="true">
        <div className={`materials-progress-bar ${percent === null ? 'is-indeterminate' : ''}`} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      {progress.current && <span className="materials-progress-current">{progress.current}</span>}
    </div>
  );
}
