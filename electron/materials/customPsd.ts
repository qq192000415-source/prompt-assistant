// 读来图定制的样机 PSD：找智能对象（换图的那层），把它下面的所有层合成一张底图 under（和买家的图无关，导入时一次算好），
// 剪贴底的范围存成 base（设计图只在这里出现），上面的层逐层存下来、出图时按原混合模式叠。合成规则在 psdComposite.ts。
// 认不出来的结构直接报出是哪一层，不猜。不依赖 Electron，Node 测试可直接加载。
import { initializeCanvas, readPsd, type Layer } from 'ag-psd';
import type { Point, Quad } from '../../src/materials/imageEdit.ts';
import type { MockupTemplate, OverLayer } from '../../src/custom/product.ts';
import { CANVAS_BLENDS, compositeLayers, layerAlpha, rasterizeLayer, type Rgba } from './psdComposite.ts';

export type { Rgba };

// 主进程里没有 canvas，只让 ag-psd 给出原始像素。
initializeCanvas(
  () => {
    throw new Error('读 PSD 不需要 canvas');
  },
  // 主进程的类型里没有 DOM 的 ImageData，形状一样就行。
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }) as never,
);

export type ParsedMockup = {
  template: MockupTemplate;
  under: Rgba;
  // 剪贴底的范围（只用 alpha）；智能对象不剪贴时为 null。
  base: Rgba | null;
  // 智能对象上面的层，和 template.over 一一对应。
  over: Rgba[];
  // 智能对象里原本放的那张图（PSD 内嵌时才有），用来出预览。
  sample: { name: string; data: Uint8Array } | null;
};

const label = (layer: Layer) => `「${layer.name ?? '未命名'}」`;

// 展开图层组：穿透、或者「正常 + 不透明 + 没蒙版」的组和直接展开没区别；别的组合出来的效果不一样，报出来让人在 PS 里合并。
function flatten(layers: Layer[] | undefined): Layer[] {
  return (layers ?? []).flatMap((layer) => {
    if (layer.hidden) return [];
    if (!layer.children) return [layer];
    const plain = layer.blendMode === 'pass through' || (layer.blendMode === 'normal' && (layer.opacity ?? 1) === 1 && !layer.mask);
    if (!plain) throw new Error(`图层组${label(layer)}设置了混合模式、不透明度或蒙版，请先在 PS 里合并这个组`);
    return flatten(layer.children);
  });
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

// 只要 alpha 的整幅图（存成 PNG 给出图时裁切用）。
function alphaImage(width: number, height: number, alpha: Float32Array): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < alpha.length; p += 1) {
    data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 255;
    data[p * 4 + 3] = alpha[p] * 255;
  }
  return { width, height, data };
}

export function parseMockupPsd(buffer: Uint8Array): ParsedMockup {
  const psd = readPsd(buffer, { useImageData: true, skipThumbnail: true, skipCompositeImageData: true });
  const layers = flatten(psd.children);
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
  const soBlend = so.blendMode ?? 'normal';
  if (soBlend !== 'multiply' && soBlend !== 'normal') throw new Error(`智能对象${label(so)}的混合模式是 ${soBlend}，暂时只认正片叠底或正常`);
  if (so.mask && !so.mask.disabled) throw new Error(`智能对象${label(so)}带蒙版，请把蒙版画在它剪贴的那个产品层上`);

  const { width, height } = psd;
  const below = layers.slice(0, soIndex);
  // 剪贴底：智能对象剪贴时是它下面最近的非剪贴层。
  let base: Rgba | null = null;
  if (so.clipping) {
    const baseLayer = [...below].reverse().find((layer) => !layer.clipping);
    if (!baseLayer || baseLayer.adjustment) throw new Error(`智能对象${label(so)}是剪贴图层，但下面没有能剪贴的普通图层`);
    base = alphaImage(width, height, layerAlpha(width, height, baseLayer));
  }
  const under = compositeLayers(width, height, below);

  const over: Rgba[] = [];
  const overLayers: OverLayer[] = [];
  for (const layer of layers.slice(soIndex + 1)) {
    if (layer.adjustment) throw new Error(`智能对象上面的调整图层${label(layer)}会改到买家的图，暂时不支持，请把它挪到智能对象下面或在 PS 里去掉`);
    const blend = CANVAS_BLENDS[layer.blendMode ?? 'normal'];
    if (!blend) throw new Error(`智能对象上面的图层${label(layer)}的混合模式是 ${layer.blendMode}，暂时不支持`);
    // 上面的剪贴层剪贴的是同一个产品层（智能对象也剪贴时）；智能对象不剪贴时它剪贴的就是买家的图，暂时不支持。
    if (layer.clipping && !so.clipping) throw new Error(`图层${label(layer)}剪贴在智能对象上，暂时不支持，请在 PS 里改成剪贴到产品层`);
    if (layer.clipping && overLayers.some((entry) => !entry.clipped)) {
      throw new Error(`智能对象上面的图层顺序太复杂（普通图层之后又有剪贴图层${label(layer)}），请在 PS 里合并上面的层`);
    }
    over.push(rasterizeLayer(width, height, layer));
    overLayers.push({ file: `over-${overLayers.length}.png`, blend, opacity: (layer.opacity ?? 1) * (layer.fillOpacity ?? 1), clipped: Boolean(layer.clipping) });
  }

  const linked = psd.linkedFiles?.find((file) => file.id === placed.id);
  return {
    template: {
      width,
      height,
      smartObject: { width: placed.width ?? 0, height: placed.height ?? 0, quad, mesh },
      blend: soBlend === 'normal' ? 'normal' : 'multiply',
      opacity: so.opacity ?? 1,
      clipped: Boolean(so.clipping),
      underFile: 'under.png',
      underIncludesBase: true,
      over: overLayers,
      hasSample: Boolean(linked?.data),
    },
    under,
    base,
    over,
    sample: linked?.data ? { name: linked.name ?? 'sample', data: linked.data } : null,
  };
}
