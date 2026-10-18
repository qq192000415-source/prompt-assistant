// 移植自 SuYan（MIT，guliacer）electron/main/library/defaultLibrarySeed.ts 里生成占位图的部分（配色和 PNG 编码原样保留，去掉了示例数据）。
// 分享链接只有提示词、没有可下载的效果图时，用它生成一张占位图，素材仍能入库。
import zlib from "node:zlib";

type SeedImagePalette = {
  imageFileName: string;
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  accent: readonly [number, number, number];
};

const seedImagePalettes: SeedImagePalette[] = [
  { imageFileName: "00000000-0000-4000-8000-000000000101.png", from: [49, 89, 81], to: [221, 98, 76], accent: [251, 214, 119] },
  { imageFileName: "00000000-0000-4000-8000-000000000102.png", from: [45, 80, 126], to: [94, 171, 161], accent: [245, 197, 93] },
  { imageFileName: "00000000-0000-4000-8000-000000000103.png", from: [64, 72, 92], to: [211, 132, 95], accent: [132, 202, 184] },
  { imageFileName: "00000000-0000-4000-8000-000000000104.png", from: [63, 58, 111], to: [172, 84, 118], accent: [236, 191, 105] },
  { imageFileName: "00000000-0000-4000-8000-000000000105.png", from: [46, 96, 113], to: [230, 145, 86], accent: [238, 220, 145] },
  { imageFileName: "00000000-0000-4000-8000-000000000106.png", from: [57, 75, 62], to: [171, 117, 72], accent: [123, 190, 148] },
  { imageFileName: "00000000-0000-4000-8000-000000000107.png", from: [50, 76, 130], to: [204, 89, 117], accent: [94, 200, 205] },
  { imageFileName: "00000000-0000-4000-8000-000000000108.png", from: [72, 82, 92], to: [80, 143, 138], accent: [242, 181, 92] },
  { imageFileName: "00000000-0000-4000-8000-000000000109.png", from: [42, 69, 101], to: [188, 92, 79], accent: [233, 214, 154] },
  { imageFileName: "00000000-0000-4000-8000-000000000110.png", from: [53, 91, 89], to: [146, 125, 178], accent: [246, 190, 103] },
  { imageFileName: "00000000-0000-4000-8000-000000000111.png", from: [44, 76, 102], to: [104, 154, 101], accent: [235, 177, 87] },
  { imageFileName: "00000000-0000-4000-8000-000000000112.png", from: [67, 76, 98], to: [185, 108, 89], accent: [127, 198, 176] },
];

export function buildImportedPromptPlaceholderSeed(title: string, prompt: string): string {
  return `${title}\n${prompt}\n${prompt}`;
}

export function createImportedPromptPlaceholderImage(seedText: string): Buffer {
  const paletteIndex = positiveModulo(hashText(seedText), seedImagePalettes.length);
  const palette = seedImagePalettes[paletteIndex];

  return createPatternPng(480, 480, palette, paletteIndex + seedText.length);
}

function createPatternPng(width: number, height: number, palette: SeedImagePalette, paletteIndex: number): Buffer {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel + 1;
  const raw = Buffer.alloc(stride * height);
  const centerX = width * (0.64 - (paletteIndex % 3) * 0.08);
  const centerY = height * (0.38 + (paletteIndex % 4) * 0.06);
  const radius = 78 + (paletteIndex % 5) * 12;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;

    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * bytesPerPixel;
      const mixRatio = (x / width) * 0.56 + (y / height) * 0.44;
      const wave = Math.sin((x + y + paletteIndex * 31) / 28) * 9;
      let red = lerp(palette.from[0], palette.to[0], mixRatio) + wave;
      let green = lerp(palette.from[1], palette.to[1], mixRatio) + wave;
      let blue = lerp(palette.from[2], palette.to[2], mixRatio) + wave;
      const diagonal = positiveModulo(x - y + paletteIndex * 18, 96);
      const distance = Math.hypot(x - centerX, y - centerY);

      if (diagonal < 18) {
        [red, green, blue] = blend([red, green, blue], palette.accent, 0.18);
      }

      if (distance < radius) {
        const strength = 0.28 * (1 - distance / radius);
        [red, green, blue] = blend([red, green, blue], palette.accent, strength);
      }

      if (x > width * 0.1 && x < width * 0.9 && y > height * 0.72 && y < height * 0.76) {
        [red, green, blue] = blend([red, green, blue], [255, 255, 255], 0.32);
      }

      raw[offset] = clampColor(red);
      raw[offset + 1] = clampColor(green);
      raw[offset + 2] = clampColor(blue);
      raw[offset + 3] = 255;
    }
  }

  return encodePng(width, height, raw);
}

function encodePng(width: number, height: number, rawRgbaRows: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);

  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdr),
    createPngChunk("IDAT", zlib.deflateSync(rawRgbaRows)),
    createPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);

  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function blend(
  base: readonly [number, number, number],
  overlay: readonly [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    lerp(base[0], overlay[0], amount),
    lerp(base[1], overlay[1], amount),
    lerp(base[2], overlay[2], amount),
  ];
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function hashText(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}