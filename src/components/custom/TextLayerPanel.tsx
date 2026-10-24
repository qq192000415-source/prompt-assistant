import { useState } from 'react';
import type { TextLayer } from '../../custom/layout';

// 文字图层的编辑：内容、字体（本机装的全部字体）、字号、颜色、描边、加粗。位置在排版区里拖。
// 读不到本机字体时（没有 queryLocalFonts 或被拒）退回 Windows 自带的几种。
const FALLBACK_FONTS = ['Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'FangSong', 'DengXian', 'Arial', 'Times New Roman'];
type LocalFont = { family: string };
let fontCache: string[] | null = null;

async function loadFonts() {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
  if (!query) return null;
  const families = [...new Set((await query()).map((font) => font.family))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return families.length ? families : null;
}

export function TextLayerPanel({ layer, onChange }: { layer: TextLayer; onChange: (patch: Partial<TextLayer>) => void }) {
  const [fonts, setFonts] = useState<string[] | null>(fontCache);
  const [fallback, setFallback] = useState(false);
  // queryLocalFonts 要在用户点击时调，所以第一次按下字体下拉时才读。
  const ensureFonts = () => {
    if (fonts) return;
    void loadFonts()
      .catch(() => null)
      .then((list) => {
        fontCache = list ?? FALLBACK_FONTS;
        setFallback(!list);
        setFonts(fontCache);
      });
  };
  const options = fonts ?? FALLBACK_FONTS;
  return (
    <>
      <label className="field">
        <span>文字（可以换行）</span>
        <textarea rows={2} value={layer.text} onChange={(event) => onChange({ text: event.target.value })} />
      </label>
      <label className="field">
        <span>字体</span>
        <select className="custom-select" value={layer.font} onPointerDown={ensureFonts} onFocus={ensureFonts} onChange={(event) => onChange({ font: event.target.value })}>
          {!options.includes(layer.font) && <option value={layer.font}>{layer.font}</option>}
          {options.map((family) => (
            <option key={family} value={family} style={{ fontFamily: `"${family}"` }}>
              {family}
            </option>
          ))}
        </select>
      </label>
      {fallback && <p className="nas-form-note">读不到这台电脑装的字体，只列出 Windows 自带的几种。</p>}
      <label className="field">
        <span>字号 {Math.round(layer.fontSize * 1000) / 10}%</span>
        <input type="range" min={1} max={40} step={0.5} value={layer.fontSize * 100} onChange={(event) => onChange({ fontSize: Number(event.target.value) / 100 })} />
      </label>
      <label className="field">
        <span>描边粗细 {Math.round(layer.strokeWidth * 100)}%</span>
        <input type="range" min={0} max={30} value={Math.round(layer.strokeWidth * 100)} onChange={(event) => onChange({ strokeWidth: Number(event.target.value) / 100 })} />
      </label>
      <span className="custom-row">
        <label className="custom-color">
          <input type="color" value={layer.color} onChange={(event) => onChange({ color: event.target.value })} />
          文字颜色
        </label>
        <label className="custom-color">
          <input type="color" value={layer.strokeColor} onChange={(event) => onChange({ strokeColor: event.target.value })} />
          描边颜色
        </label>
        <label className="custom-color">
          <input type="checkbox" checked={layer.bold} onChange={(event) => onChange({ bold: event.target.checked })} />
          加粗
        </label>
      </span>
    </>
  );
}
