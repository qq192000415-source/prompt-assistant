// 来图定制的高清放大：Real-ESRGAN（ncnn-vulkan，BSD-3）按需从更新源下载，大小和 SHA256 写死在这里，解压到 <userData>/components/realesrgan/。
// 用显卡（Vulkan）跑，电脑跑不了时返回失败原因，由界面退回普通插值放大并明确提示。不依赖 Electron，Node 测试可直接加载。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { downloadComponent, runFfmpeg } from './ffmpeg.ts';

// 由 scripts/publish-upscaler-component.cjs 重新打包上传：只留程序、dll 和照片、插画两个模型。
export const UPSCALER_COMPONENT = {
  file: 'components/realesrgan-ncnn-vulkan-20220424-x4plus.zip',
  size: 41494732,
  sha256: '5e9a27e5feb2b17e65188d0d68462a997e8e26c7c3fdf8040f9a50eb1d1f0493',
};
export const UPSCALE_MODELS = { photo: 'realesrgan-x4plus', anime: 'realesrgan-x4plus-anime' } as const;
export type UpscaleModel = keyof typeof UPSCALE_MODELS;
const UPSCALE_TIMEOUT_MS = 5 * 60_000;

const componentDir = (userDataDir: string) => path.join(userDataDir, 'components', 'realesrgan');
const exePath = (userDataDir: string) => path.join(componentDir(userDataDir), 'realesrgan-ncnn-vulkan.exe');
// 解压完才写这个标记，中途失败不会被当成装好了。
const markerPath = (userDataDir: string) => path.join(componentDir(userDataDir), '.installed');

export const isUpscalerInstalled = (userDataDir: string) => {
  try {
    return fs.readFileSync(markerPath(userDataDir), 'utf8') === UPSCALER_COMPONENT.sha256 && fs.existsSync(exePath(userDataDir));
  } catch {
    return false;
  }
};

export async function installUpscaler(userDataDir: string, updateBaseUrl: string, onProgress: (done: number, total: number) => void) {
  const dir = componentDir(userDataDir);
  const zipPath = `${dir}.zip`;
  await downloadComponent(updateBaseUrl, UPSCALER_COMPONENT, zipPath, '高清放大组件', onProgress);
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    fs.rmSync(dir, { recursive: true, force: true });
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      // 包是自己打的、校验过 SHA256，这里仍然防一下路径跳出。
      const target = path.join(dir, entry.name);
      if (!target.startsWith(dir + path.sep)) throw new Error(`组件里有不合法的路径：${entry.name}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await entry.async('nodebuffer'));
    }
    fs.writeFileSync(markerPath(userDataDir), UPSCALER_COMPONENT.sha256);
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
}

// 放大 4 倍，输出 PNG。失败（显卡不支持 Vulkan、程序出错、超时）时返回原因，不抛错，界面据此退回普通放大。
export async function upscaleImage(userDataDir: string, input: Uint8Array, ext: string, model: UpscaleModel): Promise<{ bytes: Uint8Array } | { error: string }> {
  if (!isUpscalerInstalled(userDataDir)) return { error: '还没有下载高清放大组件' };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxia-upscale-'));
  try {
    // 程序按扩展名选解码器（webp 单独处理），所以按原格式命名。
    const source = path.join(work, `in-${crypto.randomUUID()}${['.jpg', '.png', '.webp', '.bmp'].includes(ext) ? ext : '.png'}`);
    const output = path.join(work, 'out.png');
    fs.writeFileSync(source, input);
    const args = ['-i', source, '-o', output, '-n', UPSCALE_MODELS[model], '-s', '4', '-m', path.join(componentDir(userDataDir), 'models')];
    let result: { code: number | null; stderr: string };
    try {
      result = await runFfmpeg(exePath(userDataDir), args, { timeoutMs: UPSCALE_TIMEOUT_MS });
    } catch {
      // 程序根本启动不了（文件坏了、被杀毒软件拦了）：清掉安装标记，下次点会重新下载。
      fs.rmSync(markerPath(userDataDir), { force: true });
      return { error: '高清放大组件坏了，下次点「高清放大」会重新下载' };
    }
    if (result.code !== 0 || !fs.existsSync(output)) return { error: upscaleFailure(result.stderr) };
    return { bytes: fs.readFileSync(output) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// 把程序的报错换成人话；显卡相关的单独说明。
export function upscaleFailure(stderr: string) {
  if (/vkCreateInstance|vulkan|invalid gpu device|vkEnumerate/i.test(stderr)) return '这台电脑的显卡跑不了 AI 放大（不支持 Vulkan）';
  const last = stderr.trim().split(/\r?\n/).filter((line) => !/^\d+(\.\d+)?%$/.test(line.trim())).at(-1) ?? '';
  return `AI 放大程序出错${last ? `：${last.slice(0, 120)}` : ''}`;
}
