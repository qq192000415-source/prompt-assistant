// 读来图定制的样机 PSD：找第一个智能对象和它的剪贴底，拆成 under / base / over 三张整幅 RGBA 加变形几何。
// 只认「智能对象（可剪贴到下面一层）+ 普通图层」这种结构；对不上的直接报出原因，不猜。不依赖 Electron，Node 测试可直接加载。
import { initializeCanvas, readPsd, type Layer } from 'ag-psd';
import type { Point, Quad } from '../../src/materials/imageEdit.ts';
import type { MockupTemplate } from '../../src/custom/product.ts';

// 主进程里没有 canvas，只让 ag-psd 给出原始像素。
initializeCanvas(
  () => {
    throw new Error('读 PSD 不需要 canvas');
  },
  // 主进程的类型里没有 DOM 的 ImageData，形状一样就行。
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }) as never,
);

export type Rgba = { width: number; height: number; data: Uint8ClampedArray };
export type ParsedMockup = {
  template: MockupTemplate;
  under: Rgba;
  base: Rgba;
  over: Rgba | null;
  // 智能对象里原本放的那张图（PSD 内嵌时才有），用来出预览。
  sample: { name: string; data: Uint8Array } | null;
};

const visibleLayers = (layers: Layer[] | undefined): Layer[] =>
  (layers ?? []).flatMap((layer) => {
    if (layer.hidden) return [];
    if (layer.children) throw new Error(`PSD 里有图层组「${layer.name ?? ''}」，请先在 PS 里取消编组或合并后再导入`);
    return [layer];
  });

const label = (layer: Layer) => `「${layer.name ?? '未命名'}」`;

// 普通图层按不透明度叠到整幅画布上（Porter-Duff over）。别的混合模式、蒙版不认，报出来让人在 PS 里合并。
function compositeNormal(width: number, height: number, layers: Layer[]): Rgba {
  const out = new Uint8ClampedArray(width * height * 4);
  for (const layer of layers) {
    if (layer.blendMode && layer.blendMode !== 'normal' && layer.blendMode !== 'pass through') {
      throw new Error(`图层${label(layer)}的混合模式是 ${layer.blendMode}，暂时只认「正常」，请先在 PS 里把它和下面的层合并`);
    }
    if (layer.mask && !layer.mask.disabled) throw new Error(`图层${label(layer)}带蒙版，请先在 PS 里应用蒙版`);
    if (layer.clipping) throw new Error(`图层${label(layer)}是剪贴图层，暂时只认智能对象剪贴到下面一层`);
    const image = layer.imageData;
    if (!image) continue;
    const opacity = layer.opacity ?? 1;
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    for (let y = 0; y < image.height; y += 1) {
      const ty = top + y;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < image.width; x += 1) {
        const tx = left + x;
        if (tx < 0 || tx >= width) continue;
        const s = (y * image.width + x) * 4;
        const d = (ty * width + tx) * 4;
        const sa = (image.data[s + 3] / 255) * opacity;
        if (sa <= 0) continue;
        const da = out[d + 3] / 255;
        const oa = sa + da * (1 - sa);
        for (let c = 0; c < 3; c += 1) out[d + c] = (image.data[s + c] * sa + out[d + c] * da * (1 - sa)) / oa;
        out[d + 3] = oa * 255;
      }
    }
  }
  return { width, height, data: out };
}

const toQuad = (values: number[] | undefined): Quad | null =>
  values && values.length === 8
    ? [
        { x: values[0], y: values[1] },
        { x: values[2], y: values[3] },
        { x: values[4], y: values[5] },
        { x: values[6], y: values[7] },
      ]
    : null;

export function parseMockupPsd(buffer: Uint8Array): ParsedMockup {
  const psd = readPsd(buffer, { useImageData: true, skipThumbnail: true, skipCompositeImageData: true });
  const layers = visibleLayers(psd.children);
  const soIndex = layers.findIndex((layer) => layer.placedLayer);
  if (soIndex < 0) throw new Error('PSD 里没有找到智能对象（换图用的那一层要是智能对象）');
  const so = layers[soIndex];
  const placed = so.placedLayer!;
  if (layers.slice(soIndex + 1).some((layer) => layer.placedLayer)) throw new Error('PSD 里有不止一个智能对象，暂时只支持一个换图位置');

  const quad = toQuad(placed.nonAffineTransform ?? placed.transform);
  if (!quad) throw new Error(`智能对象${label(so)}读不到四角位置`);
  const style = placed.warp?.style ?? 'none';
  let mesh: Point[] | null = null;
  if (style === 'custom') {
    const points = placed.warp?.customEnvelopeWarp?.meshPoints ?? [];
    if (points.length !== 16) throw new Error(`智能对象${label(so)}的自定义变形有 ${points.length} 个控制点，暂时只认 4×4 网格`);
    mesh = points.map(({ x, y }) => ({ x, y }));
  } else if (style !== 'none') {
    throw new Error(`智能对象${label(so)}用的是「${style}」变形，暂时只认自定义变形（网格）或不变形`);
  }
  if (so.blendMode !== 'multiply' && so.blendMode !== 'normal') {
    throw new Error(`智能对象${label(so)}的混合模式是 ${so.blendMode}，暂时只认正片叠底或正常`);
  }

  // 剪贴底：智能对象剪贴时是它下面最近的那一层；不剪贴时设计图整块显示，base 留空。
  const baseIndex = so.clipping ? soIndex - 1 : -1;
  if (so.clipping && baseIndex < 0) throw new Error(`智能对象${label(so)}是剪贴图层，但下面没有图层`);
  const { width, height } = psd;
  const under = compositeNormal(width, height, layers.slice(0, so.clipping ? baseIndex : soIndex));
  const base = compositeNormal(width, height, so.clipping ? [layers[baseIndex]] : []);
  const above = layers.slice(soIndex + 1);
  const over = above.length ? compositeNormal(width, height, above) : null;

  const linked = psd.linkedFiles?.find((file) => file.id === placed.id);
  return {
    template: {
      width,
      height,
      smartObject: { width: placed.width ?? 0, height: placed.height ?? 0, quad, mesh },
      blend: so.blendMode === 'normal' ? 'normal' : 'multiply',
      opacity: so.opacity ?? 1,
      clipped: Boolean(so.clipping),
      hasOver: over !== null,
      hasSample: Boolean(linked?.data),
    },
    under,
    base,
    over,
    sample: linked?.data ? { name: linked.name ?? 'sample', data: linked.data } : null,
  };
}
