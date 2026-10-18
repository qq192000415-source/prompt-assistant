// 批量压缩：图片和视频。流程照 SuYan 的 batch 模块：逐个处理，变小了才替换，失败的逐条报告。
// 不同的是文件在 NAS 上：先下载到内存或临时文件，处理完把新文件传回 NAS，再加锁换掉记录、删掉没人用的旧文件。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { nativeImage } from 'electron';
import { mediaPath, replaceMedia, thumbPath, type MaterialMedia, type MediaReplacement } from '../../src/materials/library.ts';
import { getMediaFileExtension, mimeTypeOf } from '../../src/materials/mediaFileTypes.ts';
import { buildFfmpegArgs, parseDuration, parseProgressFraction, resolveEncoderPlans, runFfmpeg, type VideoCompressOptions } from './ffmpeg.ts';
import { mutateLibrary, readLibrary } from './libraryStore.ts';
import { exclusive, reason, type Failure, type Report } from './tasks.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

export type ImageCompressOptions = { quality: number; maxSide: number; format: 'keep' | 'jpeg' };

const THUMB_WIDTH = 480;
const FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;
const COMPRESSIBLE_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.jfif', '.png']);
// 小于原文件 95% 才算压缩成功，省几 KB 不值得换文件。
const MIN_SAVING_RATIO = 0.95;

async function sha256OfFile(filePath: string) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const renamed = (name: string, ext: string) => `${name.slice(0, name.length - getMediaFileExtension(name).length)}${ext}`;

async function pickTargets(config: DavConfig, ids: readonly string[], kind: MaterialMedia['kind']) {
  const { library } = await readLibrary(config);
  const wanted = new Set(ids);
  return library.items.filter((item) => wanted.has(item.id) && item.media.kind === kind);
}

// 加锁换记录；没换成的（压缩期间别处改过）把刚传的新文件删掉，换成的把没人用的旧文件删掉。
async function commitReplacements(config: DavConfig, replacements: MediaReplacement[], failures: Failure[]) {
  if (replacements.length === 0) return { ...(await readLibrary(config)), applied: 0 };
  const { library, dropped, result } = await mutateLibrary(config, (current) => {
    const outcome = replaceMedia(current, replacements, new Date().toISOString());
    return { library: outcome.library, result: outcome };
  });
  const inUse = new Set(library.items.map((item) => item.media.sha256));
  const removals = [
    ...result.orphaned,
    ...result.skipped.map((entry) => entry.to).filter((media) => !inUse.has(media.sha256)),
  ];
  for (const entry of result.skipped) {
    failures.push({ name: entry.from.name, message: '压缩期间这条素材在别处被改过或删掉了，没有替换' });
  }
  for (const media of removals) {
    for (const target of [mediaPath(media), ...(media.hasThumb ? [thumbPath(media)] : [])]) {
      await webdav.remove(config, target).catch((error) => failures.push({ name: target, message: `旧文件没删掉：${reason(error)}` }));
    }
  }
  return { library, dropped, applied: result.applied.length };
}

export function compressImages(config: DavConfig, ids: string[], options: ImageCompressOptions, report: Report) {
  return exclusive(async (signal) => {
    const targets = (await pickTargets(config, ids, 'image')).filter((item) => COMPRESSIBLE_IMAGE_EXTS.has(item.media.ext));
    const replacements: MediaReplacement[] = [];
    const failures: Failure[] = [];
    let notSmaller = 0;
    let savedBytes = 0;

    for (const [index, item] of targets.entries()) {
      if (signal.aborted) break;
      report({ task: '压缩图片', done: index, total: targets.length, current: item.media.name });
      try {
        const original = await webdav.readBytes(config, mediaPath(item.media));
        let image = nativeImage.createFromBuffer(original);
        if (image.isEmpty()) throw new Error('无法读取这张图片');
        const { width, height } = image.getSize();
        if (options.maxSide > 0 && Math.max(width, height) > options.maxSide) {
          image = image.resize(width >= height ? { width: options.maxSide, quality: 'best' } : { height: options.maxSide, quality: 'best' });
        }
        const toJpeg = options.format === 'jpeg' || item.media.ext !== '.png';
        const output = toJpeg ? image.toJPEG(Math.min(100, Math.max(1, Math.round(options.quality)))) : image.toPNG();
        if (output.length >= original.length * MIN_SAVING_RATIO) {
          notSmaller += 1;
          continue;
        }
        const ext = toJpeg ? (item.media.ext === '.png' ? '.jpg' : item.media.ext) : '.png';
        const sha256 = crypto.createHash('sha256').update(output).digest('hex');
        await webdav.put(config, mediaPath({ sha256, ext }), new Uint8Array(output), { 'Content-Type': mimeTypeOf(ext) });
        const thumbSource = image.getSize().width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image;
        await webdav.put(config, thumbPath({ sha256 }), new Uint8Array(thumbSource.toJPEG(82)), { 'Content-Type': 'image/jpeg' });
        const size = image.getSize();
        replacements.push({
          itemId: item.id,
          from: item.media,
          to: { ...item.media, sha256, ext, name: renamed(item.media.name, ext), size: output.length, width: size.width, height: size.height, hasThumb: true },
        });
        savedBytes += original.length - output.length;
      } catch (error) {
        failures.push({ name: item.media.name, message: reason(error) });
      }
    }

    report({ task: '压缩图片', done: targets.length, total: targets.length, current: '正在保存' });
    const committed = await commitReplacements(config, replacements, failures);
    return {
      library: committed.library,
      dropped: committed.dropped,
      processed: committed.applied,
      notSmaller,
      savedBytes,
      canceled: signal.aborted,
      skippedUnsupported: ids.length - targets.length,
      failures,
    };
  });
}

export function compressVideos(config: DavConfig, ids: string[], options: VideoCompressOptions, ffmpeg: string, report: Report) {
  return exclusive(async (signal) => {
    const targets = await pickTargets(config, ids, 'video');
    const replacements: MediaReplacement[] = [];
    const failures: Failure[] = [];
    let notSmaller = 0;
    let savedBytes = 0;
    const plans = targets.length ? await resolveEncoderPlans(ffmpeg, options) : [];
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-assistant-video-'));

    try {
      for (const [index, item] of targets.entries()) {
        if (signal.aborted) break;
        const step = (fraction: number) => report({ task: '压缩视频', done: index + fraction, total: targets.length, current: item.media.name });
        step(0);
        const input = path.join(workDir, `in${item.media.ext}`);
        const output = path.join(workDir, 'out.mp4');
        try {
          await webdav.downloadToFile(config, mediaPath(item.media), input);
          const duration = parseDuration((await runFfmpeg(ffmpeg, ['-hide_banner', '-i', input], { timeoutMs: 60000, signal })).stderr);
          let produced = false;
          let lastError = '';
          for (const plan of plans) {
            const result = await runFfmpeg(ffmpeg, buildFfmpegArgs(input, output, options, plan.videoArgs), {
              timeoutMs: FFMPEG_TIMEOUT_MS,
              signal,
              onStderr: (text) => {
                const fraction = parseProgressFraction(text, duration);
                if (fraction > 0) step(fraction);
              },
            });
            if (result.code === 0) {
              produced = true;
              break;
            }
            lastError = result.stderr.trim().split('\n').at(-1) ?? '';
            fs.rmSync(output, { force: true });
          }
          if (!produced) throw new Error(`FFmpeg 压缩失败：${lastError}`);

          const check = await runFfmpeg(ffmpeg, ['-v', 'error', '-i', output, '-t', '1', '-f', 'null', '-'], { timeoutMs: 60000, signal });
          if (check.code !== 0) throw new Error('压缩出来的视频读不了，已放弃');
          const size = fs.statSync(output).size;
          if (size >= item.media.size * MIN_SAVING_RATIO) {
            notSmaller += 1;
            continue;
          }
          const sha256 = await sha256OfFile(output);
          const stream = Readable.toWeb(fs.createReadStream(output)) as unknown as webdav.DavBody;
          await webdav.put(config, mediaPath({ sha256, ext: '.mp4' }), stream, { 'Content-Type': 'video/mp4', 'Content-Length': String(size) });
          replacements.push({
            itemId: item.id,
            from: item.media,
            to: { ...item.media, sha256, ext: '.mp4', name: renamed(item.media.name, '.mp4'), size, width: null, height: null, hasThumb: false },
          });
          savedBytes += item.media.size - size;
        } catch (error) {
          if (!signal.aborted) failures.push({ name: item.media.name, message: reason(error) });
        } finally {
          fs.rmSync(input, { force: true });
          fs.rmSync(output, { force: true });
        }
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }

    report({ task: '压缩视频', done: targets.length, total: targets.length, current: '正在保存' });
    const committed = await commitReplacements(config, replacements, failures);
    return {
      library: committed.library,
      dropped: committed.dropped,
      processed: committed.applied,
      notSmaller,
      savedBytes,
      canceled: signal.aborted,
      skippedUnsupported: ids.length - targets.length,
      failures,
    };
  });
}
