import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { generateMedia, decodeGeneratedMedia, savedItemText, CANVAS_CATEGORY } = await import('../electron/materials/canvas.ts');
const { getSharp } = await import('../electron/materials/suyan/shim.ts');
const { canvas, getCanvasState, isVideoModel, unsavedCount } = await import('../src/materials/canvasStore.ts');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');
const pngDataUrl = `data:image/png;base64,${PNG.toString('base64')}`;
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(16)]);

// 模拟 OpenAI 兼容的 /images 接口：记下请求，按 b64_json 返回一张 1×1 PNG。
function startFakeImageApi() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ url: request.url, contentType: request.headers['content-type'] ?? '', body: body.toString('utf8'), headers: request.headers });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64'), revised_prompt: '改写后的提示词' }] }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })));
}

const runtimeWith = (image, rules = '') => ({ text: null, vision: null, image, instructions: (action) => (action === 'image-generation' ? rules : '') });

test('文生图：请求 /images/generations，带上尺寸、张数、规则，返回 data URL 和模型改写的提示词', async () => {
  const api = await startFakeImageApi();
  try {
    const runtime = runtimeWith({ provider: 'openai-compatible', baseUrl: api.baseUrl, apiKey: 'test-key', model: 'gpt-image-1' }, '保持写实');
    const result = await generateMedia(runtime, { prompt: '一只橘猫', negativePrompt: '模糊', size: '1024x1024', n: 1, quality: 'high', outputFormat: 'png' });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].dataUrl, pngDataUrl);
    assert.equal(result.images[0].revisedPrompt, '改写后的提示词');
    const [request] = api.requests;
    assert.equal(request.url, '/v1/images/generations');
    assert.equal(request.headers.authorization, 'Bearer test-key');
    const body = JSON.parse(request.body);
    assert.deepEqual([body.model, body.size, body.n, body.quality], ['gpt-image-1', '1024x1024', 1, 'high']);
    assert.match(body.prompt, /一只橘猫/);
    assert.match(body.prompt, /保持写实/);
  } finally {
    api.server.close();
  }
});

test('图生图：普通模型走 multipart 的 /images/edits，grok-imagine 走 JSON 并按顺序带上多张参考图', async () => {
  const api = await startFakeImageApi();
  try {
    const references = [pngDataUrl, pngDataUrl];
    await generateMedia(runtimeWith({ provider: 'openai-compatible', baseUrl: api.baseUrl, apiKey: 'k', model: 'gpt-image-1' }), { prompt: '换成夜景', referenceImageDataUrls: [pngDataUrl] });
    assert.equal(api.requests[0].url, '/v1/images/edits');
    assert.match(api.requests[0].contentType, /^multipart\/form-data/);

    await generateMedia(runtimeWith({ provider: 'openai-compatible', baseUrl: api.baseUrl, apiKey: 'k', model: 'grok-imagine-image' }), { prompt: '换成夜景', referenceImageDataUrls: references, ratio: '16:9' });
    const grok = api.requests[1];
    assert.match(grok.contentType, /application\/json/);
    const body = JSON.parse(grok.body);
    assert.equal(body.images.length, 2);
    assert.equal(body.images[0].url, pngDataUrl);
    assert.equal(body.aspect_ratio, '16:9');
    assert.equal(body.response_format, 'b64_json');
  } finally {
    api.server.close();
  }
});

test('没设生图模型、没写提示词时明确报错，不发请求', async () => {
  await assert.rejects(Promise.resolve().then(() => generateMedia(runtimeWith(null), { prompt: '猫' })), /还没有设置生图模型/);
  await assert.rejects(Promise.resolve().then(() => generateMedia(runtimeWith({ provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', model: 'm' }), { prompt: '  ' })), /先写正向提示词/);
});

test('Agnes 视频：创建任务、轮询到完成、下载视频，返回视频 data URL', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (url === 'https://apihub.agnes-ai.com/v1/videos') return Response.json({ video_id: 'v1' });
    if (url.startsWith('https://apihub.agnes-ai.com/agnesapi')) return Response.json({ status: 'completed', url: 'https://cdn.example.com/v1.mp4' });
    if (url === 'https://cdn.example.com/v1.mp4') return new Response(MP4, { headers: { 'Content-Type': 'video/mp4' } });
    return new Response('not found', { status: 404 });
  };
  try {
    const runtime = runtimeWith({ provider: 'openai-compatible', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'k', model: 'agnes-video-2.5' });
    const result = await generateMedia(runtime, { prompt: '海浪', mediaType: 'video', videoSeconds: 6, ratio: '16:9' });
    assert.equal(result.mediaType, 'video');
    assert.equal(result.images[0].dataUrl, `data:video/mp4;base64,${MP4.toString('base64')}`);
    assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'GET']);
    assert.equal(JSON.parse(calls[0].body).model, 'agnes-video-2.5');
    assert.equal(decodeGeneratedMedia(result.images[0].dataUrl).ext, '.mp4');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('生成结果按文件内容判断格式，认不出的明确报错', () => {
  assert.equal(decodeGeneratedMedia(pngDataUrl).ext, '.png');
  // 声明成 jpeg 但内容是 PNG，按内容算。
  assert.equal(decodeGeneratedMedia(`data:image/jpeg;base64,${PNG.toString('base64')}`).ext, '.png');
  assert.equal(decodeGeneratedMedia(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).toString('base64')}`).ext, '.jpg');
  assert.throws(() => decodeGeneratedMedia('data:text/plain;base64,aGVsbG8='), /不是可识别/);
  assert.throws(() => decodeGeneratedMedia('not a data url'), /不是图片数据/);
});

test('存入素材库：提示词没改就沿用来源组的标题、分类、标签；改了就另立一组，归到「画布生成」', () => {
  const origin = { prompt: '少女 唱片店', negativePrompt: '模糊', title: '唱片店', category: '人像', tags: ['暖色'] };
  assert.deepEqual(savedItemText({ prompt: ' 少女  唱片店 ', negativePrompt: '模糊', origin }), {
    text: { title: '唱片店', prompt: ' 少女  唱片店 ', negativePrompt: '模糊', tags: ['暖色'] },
    category: '人像',
  });
  const changed = savedItemText({ prompt: '少女 唱片店 夜晚', negativePrompt: '模糊', origin });
  assert.equal(changed.category, CANVAS_CATEGORY);
  assert.deepEqual(changed.text.tags, []);
  assert.ok(changed.text.title);
  assert.equal(savedItemText({ prompt: '', negativePrompt: '', origin: null }).text.title, CANVAS_CATEGORY);
});

test('sharp 替身：从文件头读出 PNG、JPEG、WebP 的尺寸和透明通道', async () => {
  const sharp = getSharp();
  // 这张 1×1 PNG 是带透明通道的灰度图（颜色类型 4）。
  assert.deepEqual(await sharp(PNG).metadata(), { format: 'png', width: 1, height: 1, channels: 2, hasAlpha: true });
  const rgbaPng = Buffer.from(PNG);
  rgbaPng[25] = 6;
  assert.deepEqual([(await sharp(rgbaPng).metadata()).channels, (await sharp(rgbaPng).metadata()).hasAlpha], [4, true]);
  rgbaPng[25] = 2;
  assert.deepEqual([(await sharp(rgbaPng).metadata()).channels, (await sharp(rgbaPng).metadata()).hasAlpha], [3, false]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x03, 0x00, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(await sharp(jpeg).metadata(), { format: 'jpeg', width: 768, height: 512, channels: 3, hasAlpha: false });
  const webp = Buffer.alloc(32);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBPVP8X', 8, 'ascii');
  webp[20] = 0x10;
  webp.writeUIntLE(1919, 24, 3);
  webp.writeUIntLE(1079, 27, 3);
  assert.deepEqual(await sharp(webp).metadata(), { format: 'webp', width: 1920, height: 1080, channels: 4, hasAlpha: true });
  await assert.rejects(sharp(Buffer.from('nope')).metadata(), /无法读取图片尺寸/);
});

test('画布状态：生成成功记一批结果；提示词改过就不算来源组；失败时显示原因、不丢已有结果', async () => {
  const item = { id: 'a', title: '唱片店', prompt: '少女', negativePrompt: '', category: '人像', tags: ['暖色'], favorite: false, sourceUrl: '', media: {}, createdAt: '', updatedAt: '' };
  canvas.sendFromItem(item, { fileName: '', title: 'ref', dataUrl: pngDataUrl });
  const payloads = [];
  const ok = await canvas.generate('grok-imagine-image', async (payload) => {
    payloads.push(payload);
    return { model: 'grok-imagine-image', images: [{ dataUrl: pngDataUrl, revisedPrompt: null }, { dataUrl: pngDataUrl, revisedPrompt: null }] };
  });
  assert.equal(ok, true);
  assert.deepEqual(payloads[0].referenceImageDataUrls, [pngDataUrl]);
  assert.equal(payloads[0].prompt, '少女');
  assert.equal(payloads[0].mediaType, undefined);

  canvas.setDraft({ prompt: '少女 夜晚' });
  await canvas.generate('grok-imagine-image', async () => ({ model: 'grok-imagine-image', images: [{ dataUrl: pngDataUrl, revisedPrompt: '改写' }] }));
  const failed = await canvas.generate('grok-imagine-image', async () => {
    throw new Error("Error invoking remote method 'materials:canvas-generate': Error: 余额不足");
  });
  assert.equal(failed, false);

  let state = getCanvasState();
  assert.equal(state.error, '余额不足');
  assert.equal(state.phase, 'idle');
  assert.deepEqual(state.batches.map((batch) => [batch.prompt, batch.origin?.title ?? null, batch.results.length]), [
    ['少女 夜晚', null, 1],
    ['少女', '唱片店', 2],
  ]);

  canvas.markSaved(state.batches[1].results[0].id);
  canvas.reusePrompt(state.batches[0], state.batches[0].results[0]);
  state = getCanvasState();
  assert.equal(unsavedCount(state.batches), 2);
  assert.equal(state.draft.prompt, '改写');
  // Agnes 视频模型生成视频，其余按生图。
  assert.deepEqual([isVideoModel('agnes-video-2.5'), isVideoModel('grok-imagine-image')], [true, false]);
});
