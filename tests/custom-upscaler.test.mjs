import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { UPSCALER_COMPONENT, isUpscalerInstalled, upscaleFailure, upscaleImage } = await import('../electron/materials/upscaler.ts');

test('高清放大：没装组件时直接返回原因，不去跑程序', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'upscaler-'));
  try {
    assert.equal(isUpscalerInstalled(userData), false);
    assert.deepEqual(await upscaleImage(userData, new Uint8Array([1]), '.png', 'photo'), { error: '还没有下载高清放大组件' });
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('高清放大：组件坏了（程序启动不了）时返回原因并清掉安装标记，界面据此退回普通放大，临时文件不留', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'upscaler-'));
  try {
    const dir = path.join(userData, 'components', 'realesrgan');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'realesrgan-ncnn-vulkan.exe'), 'not a program');
    fs.writeFileSync(path.join(dir, '.installed'), UPSCALER_COMPONENT.sha256);
    assert.equal(isUpscalerInstalled(userData), true);
    const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('lingxia-upscale-')).length;
    const result = await upscaleImage(userData, new Uint8Array([1, 2, 3]), '.jpg', 'anime');
    assert.deepEqual(result, { error: '高清放大组件坏了，下次点「高清放大」会重新下载' });
    assert.equal(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('lingxia-upscale-')).length, before);
    // 启动不了就清掉安装标记，下次重新下载。
    assert.equal(isUpscalerInstalled(userData), false);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('高清放大：报错换成人话，显卡不支持单独说明，进度行不算报错', () => {
  assert.equal(upscaleFailure('vkCreateInstance failed -9\ninvalid gpu device'), '这台电脑的显卡跑不了 AI 放大（不支持 Vulkan）');
  assert.equal(upscaleFailure('decode image x.png failed\n10.00%\n'), 'AI 放大程序出错：decode image x.png failed');
  assert.equal(upscaleFailure(''), 'AI 放大程序出错');
});
