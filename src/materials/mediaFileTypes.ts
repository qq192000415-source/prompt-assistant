// 移植自 SuYan（MIT，guliacer）src/features/library/utils/mediaFileTypes.ts，只保留本地导入要用的部分。

export const videoFileExtensions = [
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
  '.ogv',
  '.ogg',
  '.mkv',
  '.avi',
  '.wmv',
  '.flv',
  '.3gp',
  '.3g2',
  '.ts',
  '.mts',
  '.m2ts',
  '.mpeg',
  '.mpg',
  '.asf',
  '.f4v',
] as const;

export const imageFileExtensions = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.avif',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
  '.svg',
  '.ico',
  '.jfif',
  '.apng',
] as const;

const videoFileExtensionSet = new Set<string>(videoFileExtensions);
const imageFileExtensionSet = new Set<string>(imageFileExtensions);

export function getMediaFileExtension(fileName: string): string {
  const normalizedFileName = fileName.trim().split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  const match = normalizedFileName.match(/(\.[a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? '';
}

export function isVideoMediaFile(fileName: string): boolean {
  return videoFileExtensionSet.has(getMediaFileExtension(fileName));
}

export function isImageMediaFile(fileName: string): boolean {
  return imageFileExtensionSet.has(getMediaFileExtension(fileName));
}

// 媒体协议按扩展名给 Content-Type：NAS 对 jpg/webp 等返回 application/octet-stream，<img>/<video> 认不出来。
const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mkv': 'video/x-matroska',
};

export function mimeTypeOf(fileName: string): string {
  return mimeTypes[getMediaFileExtension(fileName)] ?? 'application/octet-stream';
}
