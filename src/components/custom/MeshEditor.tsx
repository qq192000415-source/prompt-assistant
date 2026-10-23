import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Point } from '../../materials/imageEdit';
import { bezierPatch, isBorderPoint, withCoonsInterior } from '../../custom/warp';

// 用照片做样机：照片上画出 4×4 网格变形后的样子，拖四角和四条边上的点把贴图区域对准产品轮廓，中间的点自动跟着算。
// 坐标都是照片像素；SVG 的 viewBox 就是照片尺寸，拖动时按显示比例换算回去。

const LINES = 6;
const SAMPLES = 24;

export function MeshEditor({ url, width, height, mesh, onChange }: { url: string; width: number; height: number; mesh: Point[]; onChange: (mesh: Point[]) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);

  const toPhoto = (event: ReactPointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * width, y: ((event.clientY - rect.top) / rect.height) * height };
  };
  const onMove = (event: ReactPointerEvent) => {
    const index = dragging.current;
    if (index === null) return;
    const point = toPhoto(event);
    onChange(withCoonsInterior(mesh.map((entry, i) => (i === index ? point : entry))));
  };

  // 网格线：沿 u、v 各画几条曲面上的等参线，让人看清变形后的样子。
  const iso = (fixed: number, alongU: boolean) =>
    Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const t = i / SAMPLES;
      const p = alongU ? bezierPatch(mesh, t, fixed) : bezierPatch(mesh, fixed, t);
      return `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');
  const handle = Math.max(width, height) / 90;

  return (
    // --mesh-ratio 让竖图按可视高度收窄，不把页面撑出滚动条。
    <div className="custom-mesh" style={{ aspectRatio: `${width} / ${height}`, ['--mesh-ratio' as string]: width / height }}>
      <img src={url} alt="样机照片" draggable={false} />
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={onMove}
        onPointerUp={() => (dragging.current = null)}
        onPointerLeave={() => (dragging.current = null)}
        aria-label="拖边上的点，把网格对准产品轮廓"
      >
        {Array.from({ length: LINES + 1 }, (_, i) => (
          <g key={i}>
            <path d={iso(i / LINES, true)} className={i === 0 || i === LINES ? 'is-edge' : ''} />
            <path d={iso(i / LINES, false)} className={i === 0 || i === LINES ? 'is-edge' : ''} />
          </g>
        ))}
        {mesh.map((point, index) =>
          isBorderPoint(index) ? (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r={handle}
              className={index === 0 || index === 3 || index === 12 || index === 15 ? 'is-corner' : ''}
              onPointerDown={(event) => {
                dragging.current = index;
                (event.target as Element).setPointerCapture(event.pointerId);
              }}
            />
          ) : null,
        )}
      </svg>
    </div>
  );
}
