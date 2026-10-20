import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { generateMedia, decodeGeneratedMedia, savedItemText, CANVAS_CATEGORY } = await import('../electron/materials/canvas.ts');
const { getSharp } = await import('../electron/materials/suyan/shim.ts');
const { canvas, getCanvasState, isActive, isVideoModel, savedInHistory, visibleTasks } = await import('../src/materials/canvasStore.ts');

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

test('画布状态：提交只带一次来源组（提示词改过就不算），队列在前、历史在后合并去重，可搜索，已存标记来自历史', async () => {
  const item = { id: 'a', title: '唱片店', prompt: '少女', negativePrompt: '', category: '人像', tags: ['暖色'], favorite: false, sourceUrl: '', media: {}, createdAt: '', updatedAt: '' };
  canvas.sendFromItem(item, { fileName: '', title: 'ref', dataUrl: pngDataUrl });
  canvas.setDraft({ count: 3 });
  const submitted = [];
  const request = async (input) => {
    submitted.push(input);
    return 'task-id';
  };
  assert.equal(await canvas.submit('grok-imagine-image', request), true);
  assert.deepEqual(submitted[0].payload.referenceImageDataUrls, [pngDataUrl]);
  assert.equal(submitted[0].count, 3);
  assert.equal(submitted[0].payload.mediaType, undefined);
  assert.equal(submitted[0].origin.title, '唱片店');

  canvas.setDraft({ prompt: '少女 夜晚' });
  await canvas.submit('agnes-video-2.5', request);
  assert.equal(submitted[1].origin, null);
  assert.equal(submitted[1].payload.mediaType, 'video');

  assert.equal(await canvas.submit('grok-imagine-image', async () => {
    throw new Error("Error invoking remote method 'materials:canvas-submit': Error: 还没有设置生图模型");
  }), false);
  assert.equal(getCanvasState().error, '还没有设置生图模型');

  const task = (id, prompt, slots) => ({ id, createdAt: '', model: 'grok-imagine-image', prompt, negativePrompt: '', params: {}, origin: null, referenceCount: 0, total: slots.length, slots });
  const slot = (index, status, savedToLibrary = false) => ({ index, status, attempts: 1, error: '', media: null, revisedPrompt: null, savedToLibrary });
  const queue = [task('q1', '橘猫 窗台', [slot(0, 'running')]), task('h1', '橘猫 窗台', [slot(0, 'done')])];
  const history = [task('h1', '橘猫 窗台', [slot(0, 'done', true)]), task('h2', '海边 日落', [slot(0, 'done')])];
  assert.deepEqual(visibleTasks(queue, history, '').map((entry) => entry.id), ['q1', 'h1', 'h2']);
  assert.deepEqual(visibleTasks(queue, history, '日落 海边').map((entry) => entry.id), ['h2']);
  assert.deepEqual(visibleTasks(queue, history, 'GROK 橘猫').map((entry) => entry.id), ['q1', 'h1']);
  assert.equal(savedInHistory(history, 'h1', 0), true);
  assert.equal(savedInHistory(history, 'h2', 0), false);
  assert.deepEqual([isActive(queue[0]), isActive(queue[1])], [true, false]);

  canvas.reusePrompt(task('h3', '原提示词', [{ ...slot(0, 'done'), revisedPrompt: '模型改写的' }]), { ...slot(0, 'done'), revisedPrompt: '模型改写的' });
  assert.equal(getCanvasState().draft.prompt, '模型改写的');
  canvas.reusePrompt(task('h4', '原提示词', []));
  assert.equal(getCanvasState().draft.prompt, '原提示词');
  assert.deepEqual([isVideoModel('agnes-video-2.5'), isVideoModel('grok-imagine-image')], [true, false]);
});

// 队列和历史按创建时间统一排序：队列里的任务不再总排在前面，另一台电脑同一时段生成的按时间插进来。
test('生成记录按时间排序：最新优先、最早优先，队列和历史交错', () => {
  const at = (id, minutes) => ({ id, createdAt: new Date(Date.UTC(2026, 9, 19, 8, minutes)).toISOString(), model: 'm', prompt: id, negativePrompt: '', params: {}, origin: null, referenceCount: 0, total: 1, slots: [] });
  const queue = [at('q-08:30', 30), at('q-08:10', 10)];
  const history = [at('h-08:20', 20), at('h-08:40', 40), at('h-08:00', 0)];
  assert.deepEqual(visibleTasks(queue, history, '').map((task) => task.id), ['h-08:40', 'q-08:30', 'h-08:20', 'q-08:10', 'h-08:00']);
  assert.deepEqual(visibleTasks(queue, history, '', 'oldest').map((task) => task.id), ['h-08:00', 'q-08:10', 'h-08:20', 'q-08:30', 'h-08:40']);
  assert.deepEqual(visibleTasks(queue, history, 'q-', 'oldest').map((task) => task.id), ['q-08:10', 'q-08:30']);
});

// 主人反馈：选 16:9 出来竖图。实测网关不认 size 参数，只按提示词决定横竖，所以比例也要写进生成规则。
test('选了固定尺寸时，生成规则里写明比例和横竖；自动尺寸不写', async () => {
  const { aspectRatioRule } = await import('../electron/materials/canvas.ts');
  const landscape = aspectRatioRule({ size: '1312x736', ratio: '16:9' });
  assert.match(landscape, /16:9 横版（1312×736）/);
  assert.match(landscape, /16:9 landscape/);
  assert.match(aspectRatioRule({ size: '832x1248', ratio: '2:3' }), /2:3 竖版/);
  assert.match(aspectRatioRule({ size: '800x1200' }), /画面比例必须是 竖版（800×1200）/);
  assert.match(aspectRatioRule({ size: '1024x1024', ratio: '1:1' }), /1:1 方形/);
  assert.equal(aspectRatioRule({ size: 'auto' }), '');
  assert.equal(aspectRatioRule({}), '');
});

test('生图请求的提示词里带上比例规则，和用户自己的生成规则一起发', async () => {
  const api = await startFakeImageApi();
  try {
    await generateMedia(runtimeWith({ provider: 'openai-compatible', baseUrl: api.baseUrl, apiKey: 'k', model: 'gpt-image-2.5-sunburst' }), { prompt: '窗边的女孩', size: '1312x736', ratio: '16:9', n: 1 });
    const body = JSON.parse(api.requests.at(-1).body);
    assert.equal(body.size, '1312x736');
    assert.match(body.prompt, /窗边的女孩/);
    assert.match(body.prompt, /画面比例必须是 16:9 横版（1312×736）/);
  } finally {
    api.server.close();
  }
});

test('模型给的图横竖不对、或宽高比偏差超过 8% 时给出提示，小偏差不算不对', async () => {
  const { sizeMismatchWarning } = await import('../electron/materials/canvas.ts');
  const pngOf = (width, height) => {
    const png = Buffer.from(PNG);
    png.writeUInt32BE(width, 16);
    png.writeUInt32BE(height, 20);
    return png;
  };
  const warning = sizeMismatchWarning({ size: '1312x736', ratio: '16:9' }, pngOf(1024, 1536));
  assert.match(warning, /选的是 16:9 横版，模型给的是 1024×1536 竖版/);
  // 2026-10-20 真实网关验收：9:16 偶尔给出 850×1851（偏 18%），之前只比横竖，没有提示
  assert.match(sizeMismatchWarning({ size: '736x1312', ratio: '9:16' }, pngOf(850, 1851)), /比例偏了：选的是 9:16（736×1312），模型给的是 850×1851，宽高比差了 18%/);
  // 16:9 给成 1536×1024 其实是 3:2，也提示
  assert.match(sizeMismatchWarning({ size: '1312x736', ratio: '16:9' }, pngOf(1536, 1024)), /宽高比差了 16%/);
  assert.equal(sizeMismatchWarning({ size: '1312x736', ratio: '16:9' }, pngOf(1673, 940)), '');
  assert.equal(sizeMismatchWarning({ size: '736x1312', ratio: '9:16' }, pngOf(941, 1672)), '');
  assert.equal(sizeMismatchWarning({ size: '1024x1024' }, pngOf(1050, 1000)), '');
  assert.equal(sizeMismatchWarning({ size: 'auto' }, pngOf(1024, 1536)), '');
  assert.equal(sizeMismatchWarning({ size: '1312x736' }, Buffer.from('不是图片')), '');
});

test('全量恢复：从历史参数反推尺寸（比例+分辨率 / 自定义 / 自动）、质量、格式、张数、透明背景，参考图换成当时的', async () => {
  const { restoreDraftParams } = await import('../src/materials/canvasStore.ts');
  const task = (size, ratio, total = 2, extra = {}) => ({ params: { size, ratio, quality: 'high', outputFormat: 'webp', background: 'auto', mediaType: 'image', ...extra }, total });
  assert.deepEqual(restoreDraftParams(task('1312x736', '16:9')), { count: 2, transparentBackground: false, quality: 'high', outputFormat: 'webp', sizeMode: 'ratio', aspectRatio: '16:9', baseResolution: '1k' });
  assert.equal(restoreDraftParams(task('2048x2048', '1:1')).baseResolution, '2k');
  assert.deepEqual(restoreDraftParams(task('1000x777', '')), { count: 2, transparentBackground: false, quality: 'high', outputFormat: 'webp', sizeMode: 'custom', customWidth: 1000, customHeight: 777 });
  assert.equal(restoreDraftParams(task('auto', '')).sizeMode, 'auto');
  // 认不出的质量和格式不动草稿；张数夹在 1–4
  const odd = restoreDraftParams(task('auto', '', 9, { quality: 'ultra', outputFormat: 'bmp', background: 'transparent' }));
  assert.deepEqual([odd.quality, odd.outputFormat, odd.count, odd.transparentBackground], [undefined, undefined, 4, true]);

  const historyTask = { id: 'h', createdAt: '', model: 'm', prompt: '原提示词', negativePrompt: '模糊', params: task('1312x736', '16:9').params, origin: null, referenceCount: 1, total: 3, slots: [] };
  canvas.addReferences([{ fileName: '', title: '旧的', dataUrl: pngDataUrl }]);
  canvas.restoreTask(historyTask, [{ fileName: '', title: '当时的参考图', dataUrl: pngDataUrl }]);
  const { draft } = getCanvasState();
  assert.deepEqual([draft.prompt, draft.negativePrompt, draft.sizeMode, draft.aspectRatio, draft.count, draft.referenceImages.map((image) => image.title)], ['原提示词', '模糊', 'ratio', '16:9', 3, ['当时的参考图']]);
});

test('参考图：拖动换顺序（顺序就是提交顺序），一键清空', async () => {
  canvas.clearReferences();
  canvas.addReferences(['一', '二', '三'].map((title) => ({ fileName: '', title, dataUrl: `data:image/png;base64,${Buffer.from(title).toString('base64')}` })));
  const titles = () => getCanvasState().draft.referenceImages.map((image) => image.title);
  canvas.moveReference(2, 0);
  assert.deepEqual(titles(), ['三', '一', '二']);
  canvas.moveReference(0, 2);
  assert.deepEqual(titles(), ['一', '二', '三']);
  canvas.moveReference(1, 9); // 越界不动
  assert.deepEqual(titles(), ['一', '二', '三']);
  // 提交给接口的参考图顺序和界面上一致
  const { buildCanvasImageGenerationPayload } = await import('../src/materials/suyan/canvasGeneration.ts');
  const sent = buildCanvasImageGenerationPayload(getCanvasState().draft).referenceImageDataUrls.map((url) => Buffer.from(url.split(',')[1], 'base64').toString());
  assert.deepEqual(sent, ['一', '二', '三']);
  canvas.clearReferences();
  assert.deepEqual(titles(), []);
});

test('局部重绘：编辑后按对象换掉参考图；遮罩只能在第 1 张，提交时带上，multipart 请求里多一个 mask 字段', async () => {
  canvas.clearReferences();
  canvas.setDraft({ prompt: '移除绿色标记区域' });
  canvas.addReferences([{ fileName: '', title: '甲', dataUrl: pngDataUrl }, { fileName: '', title: '乙', dataUrl: pngDataUrl }]);
  const [first, second] = getCanvasState().draft.referenceImages;
  const masked = { fileName: '', title: '乙', dataUrl: pngDataUrl, sourceDataUrl: pngDataUrl, maskDataUrl: pngDataUrl };
  canvas.moveReference(1, 0); // 编辑期间换了位置也能按对象找到
  assert.equal(canvas.replaceReference(second, masked), true);
  assert.equal(getCanvasState().draft.referenceImages[0], masked);
  assert.equal(canvas.replaceReference({ ...first }, masked), false); // 已经不在列表里的不替换

  const submitted = [];
  const request = async (input) => (submitted.push(input), 'task-id');
  assert.equal(await canvas.submit('gpt-image-2', request), true);
  assert.equal(submitted[0].payload.maskDataUrl, pngDataUrl);

  canvas.moveReference(0, 1);
  assert.equal(await canvas.submit('gpt-image-2', request), false);
  assert.match(getCanvasState().error, /第 1 张/);
  assert.equal(submitted.length, 1);
  canvas.clearReferences();
  canvas.clearError();

  const api = await startFakeImageApi();
  try {
    await generateMedia(runtimeWith({ provider: 'openai-compatible', baseUrl: api.baseUrl, apiKey: 'k', model: 'gpt-image-2' }), { prompt: '移除绿色标记区域', referenceImageDataUrls: [pngDataUrl], maskDataUrl: pngDataUrl });
    assert.equal(api.requests[0].url, '/v1/images/edits');
    assert.match(api.requests[0].body, /name="mask"; filename="mask\.png"/);
    await generateMedia(runtimeWith({ provider: 'openai-compatible', baseUrl: api.baseUrl, apiKey: 'k', model: 'gpt-image-2' }), { prompt: '换成夜景', referenceImageDataUrls: [pngDataUrl] });
    assert.doesNotMatch(api.requests[1].body, /name="mask"/);
  } finally {
    api.server.close();
  }
});

test('新增比例 4:5、5:4、9:21：尺寸是 16 的倍数且比例准确，草稿保留，全量恢复能反推，Agnes 不认识时按像素请求', async () => {
  const { canvasAspectRatioOptions, normalizeCanvasDraftSettings, resolveCanvasGenerationSize } = await import('../src/materials/suyan/canvasGeneration.ts');
  const { restoreDraftParams } = await import('../src/materials/canvasStore.ts');
  const { resolveAgnesImageRequestSize } = await import('../electron/materials/suyan/remoteAiClient.ts');
  assert.deepEqual(canvasAspectRatioOptions.map((option) => option.value), ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '5:4', '4:5', '21:9', '9:21']);
  for (const ratio of ['5:4', '4:5', '9:21']) {
    const [rw, rh] = ratio.split(':').map(Number);
    for (const baseResolution of ['1k', '2k', '3k', '4k']) {
      const size = resolveCanvasGenerationSize({ sizeMode: 'ratio', aspectRatio: ratio, baseResolution, customWidth: 0, customHeight: 0 });
      const [w, h] = size.split('x').map(Number);
      assert.equal(w % 16 + (h % 16), 0, `${ratio} ${baseResolution} ${size}`);
      assert.ok(Math.abs(w / h - rw / rh) < 0.01, `${ratio} ${baseResolution} ${size}`);
    }
  }
  assert.equal(resolveCanvasGenerationSize({ sizeMode: 'ratio', aspectRatio: '4:5', baseResolution: '1k', customWidth: 0, customHeight: 0 }), '896x1120');
  assert.equal(normalizeCanvasDraftSettings({ aspectRatio: '9:21' }).aspectRatio, '9:21');
  assert.deepEqual(restoreDraftParams({ params: { size: '2240x1792', ratio: '5:4', quality: 'auto', outputFormat: 'png', background: 'opaque' }, total: 1 }).aspectRatio, '5:4');
  assert.deepEqual(resolveAgnesImageRequestSize('agnes-image-2.1', { size: '896x1120', ratio: '4:5' }), { size: '896x1120' });
  assert.deepEqual(resolveAgnesImageRequestSize('agnes-image-2.1', { size: '1568x672', ratio: '21:9' }), { size: '1K', ratio: '21:9' });
});

test('画布模板：存在 NAS 的 canvas-templates.json，新建、重复内容不再加、编辑、记使用次数、删除；坏 JSON 不覆盖', async () => {
  const { readTemplates, mutateTemplates, saveTemplate, deleteTemplate, markTemplateUsed, normalizeTemplates } = await import('../electron/materials/canvasTemplates.ts');
  const { startFakeNas } = await import('./helpers/fake-nas.mjs');
  const nas = await startFakeNas();
  const now = '2026-10-20T08:00:00.000Z';
  try {
    assert.deepEqual((await readTemplates(nas.config)).templates.templates, []);
    const created = await mutateTemplates(nas.config, (current) => saveTemplate(current, { title: '', content: '电商主图\n白底', category: ' ' }, now));
    assert.equal(created.result.duplicate, false);
    assert.deepEqual(
      created.templates.templates.map(({ title, category, useCount }) => ({ title, category, useCount })),
      [{ title: '电商主图', category: '未分类', useCount: 0 }],
    );
    const again = await mutateTemplates(nas.config, (current) => saveTemplate(current, { title: '别的标题', content: ' 电商主图\n白底 ', category: '常用' }, now));
    assert.deepEqual([again.result.duplicate, again.result.id, again.templates.templates.length], [true, created.result.id, 1]);

    const id = created.result.id;
    await mutateTemplates(nas.config, (current) => saveTemplate(current, { id, title: '主图', content: '电商主图\n白底\n正面', category: '电商' }, now));
    await mutateTemplates(nas.config, (current) => ({ templates: markTemplateUsed(markTemplateUsed(current, id, now), id, now), result: null }));
    const [saved] = (await readTemplates(nas.config)).templates.templates;
    assert.deepEqual([saved.title, saved.category, saved.content, saved.useCount], ['主图', '电商', '电商主图\n白底\n正面', 2]);
    await assert.rejects(mutateTemplates(nas.config, (current) => saveTemplate(current, { id: 'gone', title: '', content: 'x', category: '' }, now)), /已经被删掉了/);
    await assert.rejects(mutateTemplates(nas.config, (current) => saveTemplate(current, { title: '', content: '  ', category: '' }, now)), /不能是空的/);

    await mutateTemplates(nas.config, (current) => ({ templates: deleteTemplate(current, id, now), result: null }));
    assert.deepEqual((await readTemplates(nas.config)).templates.templates, []);
    assert.equal(nas.locks.size, 0);

    nas.files.set('/团队文件-素材/canvas-templates.json', Buffer.from('{ broken'));
    await assert.rejects(mutateTemplates(nas.config, (current) => saveTemplate(current, { title: '', content: 'x', category: '' }, now)), /不是有效的 JSON/);
    assert.equal(nas.files.get('/团队文件-素材/canvas-templates.json').toString(), '{ broken');
  } finally {
    nas.server.close();
  }
  assert.equal(normalizeTemplates({ templates: [{ id: 'a', content: '猫' }, { id: '', content: 'x' }, { id: 'b', content: '' }, 'junk'] }).dropped, 3);
});
