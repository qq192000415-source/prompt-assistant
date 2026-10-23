// 生产图规格：一面按 300dpi 换像素；两面的产品拼成长条（宽 W、高 2W+1，上正面下背面，每面顺时针转 90°，中间 1 行白），
// 和客户图库里的生产图一致（FXBZ 系列实测）。Node 测试直接加载本文件。
export const PRODUCTION_DPI = 300;

export const cmToPx = (cm: number, dpi = PRODUCTION_DPI) => Math.round((cm / 2.54) * dpi);

export type FacePlacement = { face: 'front' | 'back'; x: number; y: number; size: number; rotation: 90 };
export type StripLayout = { width: number; height: number; faces: FacePlacement[] };

// ponytail: 只有两面长条这一种拼法（第一阶段只做方形抱枕），一面的产品（手机壳等）加进来时再按工厂样例加拼法。
export function stripLayout(sizeCm: number): StripLayout {
  const size = cmToPx(sizeCm);
  return {
    width: size,
    height: size * 2 + 1,
    faces: [
      { face: 'front', x: 0, y: 0, size, rotation: 90 },
      { face: 'back', x: 0, y: size + 1, size, rotation: 90 },
    ],
  };
}

// 文件名照图库：(40cmx40cm)FXBZ37号.jpg；名称里不能放进文件名的字符换成下划线。
export const productionFileName = (sizeCm: number, name: string) =>
  `(${sizeCm}cmx${sizeCm}cm)${name.trim().replace(/[\\/:*?"<>|]/g, '_') || '未命名'}.jpg`;

// 浏览器出的 JPEG 在 JFIF 头里写的是 1:1 比例，不是 dpi；打印软件按 dpi 算尺寸，所以改成 300dpi（和图库文件一样）。
// 不是 JFIF 开头的（理论上不会）原样返回，调用方会照样存，只是没有 dpi。
export function setJpegDpi<T extends Uint8Array>(bytes: T, dpi = PRODUCTION_DPI): T {
  const isJfif =
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.slice(6, 11)) === 'JFIF\0';
  if (!isJfif) return bytes;
  const out = bytes.slice() as T;
  out[13] = 1;
  out[14] = dpi >> 8;
  out[15] = dpi & 0xff;
  out[16] = dpi >> 8;
  out[17] = dpi & 0xff;
  return out;
}
