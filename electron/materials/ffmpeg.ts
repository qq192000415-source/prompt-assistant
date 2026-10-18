// FFmpeg 组件：按需从更新源下载并校验，编码器选择、参数和进度解析移植自 SuYan（MIT，guliacer）
// electron/main/runtime/ffmpegEncoders.ts、electron/main/batch/videoCompressor.ts。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// gyan.dev 8.1.2 essentials（GPL v3），由 scripts/publish-ffmpeg-component.cjs 上传到更新源 components/ 目录。
export const FFMPEG_COMPONENT = {
  file: 'components/ffmpeg-8.1.2-essentials_build-www.gyan.dev.exe',
  size: 101897728,
  sha256: '1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e',
};

export const ffmpegPath = (userDataDir: string) => path.join(userDataDir, 'components', path.basename(FFMPEG_COMPONENT.file));

// 启动后只比大小；下载那一次已经完整校验过 SHA256。
export const isFfmpegInstalled = (userDataDir: string) => {
  try {
    return fs.statSync(ffmpegPath(userDataDir)).size === FFMPEG_COMPONENT.size;
  } catch {
    return false;
  }
};

export async function installFfmpeg(userDataDir: string, updateBaseUrl: string, onProgress: (done: number, total: number) => void) {
  if (!updateBaseUrl) {
    throw new Error('这个版本没有配置更新源，无法下载 FFmpeg');
  }
  const target = ffmpegPath(userDataDir);
  const partial = `${target}.part`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const url = `${updateBaseUrl.replace(/\/+$/, '')}/${FFMPEG_COMPONENT.file}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`下载 FFmpeg 失败：${error instanceof Error ? error.message : error}`);
  }
  if (!response.ok || !response.body) {
    throw new Error(`下载 FFmpeg 失败：服务器返回 ${response.status}`);
  }

  const hash = crypto.createHash('sha256');
  let done = 0;
  let lastReport = 0;
  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  source.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    done += chunk.length;
    if (done - lastReport > 1024 * 1024 || done === FFMPEG_COMPONENT.size) {
      lastReport = done;
      onProgress(done, FFMPEG_COMPONENT.size);
    }
  });
  try {
    await pipeline(source, fs.createWriteStream(partial));
    const sha256 = hash.digest('hex');
    if (done !== FFMPEG_COMPONENT.size || sha256 !== FFMPEG_COMPONENT.sha256) {
      throw new Error('下载的 FFmpeg 校验不通过（大小或 SHA256 不对），已丢弃');
    }
    fs.renameSync(partial, target);
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

export type VideoCompressOptions = {
  resolution: 'original' | '1080p' | '720p' | '480p';
  crf: number;
  codec: 'h264' | 'h265';
};

type EncoderPlan = { encoder: string; videoArgs: string[] };

const clampQuality = (crf: number) => (Number.isFinite(crf) ? Math.min(51, Math.max(0, Math.round(crf))) : 28);

const hardwareEncoders: Record<VideoCompressOptions['codec'], Array<{ encoder: string; vendor: 'nvenc' | 'qsv' | 'amf' }>> = {
  h264: [
    { encoder: 'h264_nvenc', vendor: 'nvenc' },
    { encoder: 'h264_qsv', vendor: 'qsv' },
    { encoder: 'h264_amf', vendor: 'amf' },
  ],
  h265: [
    { encoder: 'hevc_nvenc', vendor: 'nvenc' },
    { encoder: 'hevc_qsv', vendor: 'qsv' },
    { encoder: 'hevc_amf', vendor: 'amf' },
  ],
};

export function hardwareQualityArgs(vendor: 'nvenc' | 'qsv' | 'amf', crf: number): string[] {
  const q = String(clampQuality(crf));
  if (vendor === 'nvenc') return ['-rc', 'vbr', '-cq', q, '-preset', 'p5'];
  if (vendor === 'qsv') return ['-global_quality', q, '-preset', 'medium'];
  return ['-rc', 'cqp', '-qp_i', q, '-qp_p', q, '-quality', 'balanced'];
}

export function buildFfmpegArgs(input: string, output: string, options: VideoCompressOptions, videoArgs: string[]): string[] {
  const args = ['-hide_banner', '-i', input];
  const height = { '1080p': 1080, '720p': 720, '480p': 480 }[options.resolution as '1080p'];
  // 只缩小不放大：原视频比目标还矮就保持原样。
  if (height) args.push('-vf', `scale=-2:'min(${height},ih)'`);
  args.push(...videoArgs, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', output);
  return args;
}

export function parseDuration(stderr: string): number {
  const match = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

export function parseProgressFraction(text: string, duration: number): number {
  if (duration <= 0) return 0;
  const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = matches.at(-1);
  if (!last) return 0;
  return Math.min((Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])) / duration, 1);
}

export function runFfmpeg(
  exe: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal; onStderr?: (text: string) => void },
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(exe, args, { windowsHide: true });
    let stderr = '';
    const onAbort = () => proc.kill('SIGKILL');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => proc.kill('SIGKILL'), options.timeoutMs);
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      // 只留最后 64KB，长视频的进度输出很多。
      stderr = (stderr + text).slice(-65536);
      options.onStderr?.(text);
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) reject(new Error('已取消'));
      else resolve({ code, stderr });
    });
  });
}

const usableEncoders = new Map<string, boolean>();

async function isEncoderUsable(exe: string, encoder: string): Promise<boolean> {
  const cached = usableEncoders.get(encoder);
  if (cached !== undefined) return cached;
  const result = await runFfmpeg(
    exe,
    ['-hide_banner', '-f', 'lavfi', '-i', 'testsrc=duration=0.1:size=256x256:rate=10', '-frames:v', '1', '-c:v', encoder, '-f', 'null', '-'],
    { timeoutMs: 15000 },
  ).catch(() => ({ code: 1, stderr: '' }));
  usableEncoders.set(encoder, result.code === 0);
  return result.code === 0;
}

// 有能用的显卡编码器就先用它（快很多），失败再退回 libx264/libx265 软件编码。
export async function resolveEncoderPlans(exe: string, options: VideoCompressOptions): Promise<EncoderPlan[]> {
  const plans: EncoderPlan[] = [];
  for (const candidate of hardwareEncoders[options.codec]) {
    if (await isEncoderUsable(exe, candidate.encoder)) {
      plans.push({ encoder: candidate.encoder, videoArgs: ['-c:v', candidate.encoder, ...hardwareQualityArgs(candidate.vendor, options.crf)] });
      break;
    }
  }
  const software = options.codec === 'h265' ? 'libx265' : 'libx264';
  plans.push({ encoder: software, videoArgs: ['-c:v', software, '-crf', String(clampQuality(options.crf)), '-preset', 'medium'] });
  return plans;
}
