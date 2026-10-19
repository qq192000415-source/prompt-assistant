import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampCanvasDetailWidth } from './localState';

// 拖详情栏左边缘改宽度（画布和文档库共用），照侧栏的做法：松手时才写进本机；左右方向键每次 24px。
export function useDetailResize(load: () => number, save: (width: number) => void) {
  const [width, setWidth] = useState(load);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    document.body.classList.add('resizing-detail');
    const move = (moveEvent: globalThis.PointerEvent) => {
      latest = clampCanvasDetailWidth(startWidth + startX - moveEvent.clientX);
      setWidth(latest);
    };
    const up = () => {
      document.body.classList.remove('resizing-detail');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      save(latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0;
    if (!step) return;
    event.preventDefault();
    const next = clampCanvasDetailWidth(width + step);
    setWidth(next);
    save(next);
  };

  return { width, resizerProps: { onPointerDown, onKeyDown } };
}
