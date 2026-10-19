import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';

const { batchClassify, batchReverse, classifyItem, knownCategoriesOf, optimizePrompt, reversePrompt, translatePrompt } = await import('../electron/materials/ai.ts');
const { mutateLibrary, readLibrary } = await import('../electron/materials/libraryStore.ts');
const { startFakeNas } = await import('./helpers/fake-nas.mjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64');
const sha = (n) => String(n).padStart(64, '0');
const item = (id, overrides = {}) => ({
  id,
  title: id,
  prompt: '',
  negativePrompt: '',
  category: '',
  tags: [],
  favorite: false,
  sourceUrl: '',
  media: { sha256: sha(id.length + id.charCodeAt(0)), ext: '.png', kind: 'image', name: `${id}.png`, size: PNG.length, width: 1, height: 1, hasThumb: false },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  ...overrides,
});

const categoryAnswer = JSON.stringify({
  schemaVersion: 2,
  title: '',
  summary: '少女在唱片店',
  categories: [
    { label: '柔光', confidence: 0.7, evidence: ['光线柔和'], primary: false },
    { label: '少女', confidence: 0.8, evidence: ['年轻女性'], primary: false },
    { label: '场景细分', confidence: 0.6, evidence: ['小模型把维度组名当分类'], primary: false },
    { label: '自定义分类', confidence: 0.5, evidence: [], primary: false },
    { label: '肖像摄影', confidence: 0.9, evidence: ['人物居中'], primary: true },
  ],
  tags: [],
  safety: { rating: 'unknown', confidence: 0, evidence: [] },
});
const tagAnswer = JSON.stringify({
  schemaVersion: 2,
  title: '',
  summary: '',
  categories: [],
  tags: [{ label: '黑胶唱片', group: '物品/道具', dimension: 'subject', confidence: 0.9, evidence: ['手持唱片'] }],
  safety: { rating: 'unknown', confidence: 0, evidence: [] },
});

// 按系统提示词认出是哪个功能，返回 SuYan 期望的格式。同一个函数给 OpenAI 兼容接口和 Ollama 用。
function answerFor(system, provider, user = '') {
  if (system.includes('像素级图像反推') || system.includes('图像反推提示词助手')) {
    return provider === 'ollama' ? JSON.stringify({ prompt: '少女挑选黑胶唱片，暖色灯光' }) : '反推提示词：少女挑选黑胶唱片，暖色灯光';
  }
  if (system.includes('提示词优化器')) return '优化后的提示词';
  if (system.includes('翻译器')) {
    // 照实测的 grok-4.3：正向原样返回，只译负向。
    if (user.includes('原样返回这句')) return JSON.stringify({ prompt: '原样返回这句', negativePrompt: 'blurry' });
    return JSON.stringify({ prompt: 'a girl picking vinyl records', negativePrompt: 'blurry' });
  }
  if (system.includes('分类识别器')) return categoryAnswer;
  if (system.includes('识别标签')) return tagAnswer;
  return '连接成功';
}

function startFakeAi(provider) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push({ url: request.url, headers: request.headers, body: parsed });
      const system = parsed.messages?.[0]?.content ?? '';
      const user = JSON.stringify(parsed.messages?.[1]?.content ?? '');
      const content = answerFor(system, provider, user);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(provider === 'ollama' ? { message: { role: 'assistant', content } } : { choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const slot = provider === 'ollama'
        ? { provider, baseUrl: `http://127.0.0.1:${port}`, apiKey: '', model: 'qwen2.5vl:7b' }
        : { provider, baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key', model: 'vision-model' };
      resolve({ server, requests, slot });
    });
  });
}

const runtimeOf = (slots, rules = {}) => ({ text: null, vision: null, image: null, ...slots, instructions: (action) => rules[action] ?? '' });

async function seed(nas, items) {
  for (const entry of items) nas.files.set(decodeURIComponent(new URL(`media/${entry.media.sha256}${entry.media.ext}`, nas.config.baseUrl).pathname), PNG);
  await mutateLibrary(nas.config, (library) => ({ library: { ...library, items }, result: null }));
}

const tempLeftovers = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('prompt-assistant-ai-'));

test('反推：把 NAS 上的图发给视觉模型，带上选用的规则，临时文件用完就删', async () => {
  const nas = await startFakeNas();
  const ai = await startFakeAi('openai-compatible');
  try {
    const target = item('a');
    await seed(nas, [target]);
    const before = tempLeftovers().length;
    const prompt = await reversePrompt(runtimeOf({ vision: ai.slot }, { 'image-reverse': '只写看得见的东西' }), nas.config, target);
    assert.equal(prompt, '少女挑选黑胶唱片，暖色灯光');
    const [request] = ai.requests;
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer test-key');
    assert.match(request.body.messages[0].content, /只写看得见的东西/);
    assert.equal(request.body.messages[1].content[1].image_url.url, `data:image/png;base64,${PNG.toString('base64')}`);
    assert.equal(tempLeftovers().length, before);
  } finally {
    nas.server.close();
    ai.server.close();
  }
});

test('没有视觉模型时反推给出明确提示；视频没有封面也明确提示', async () => {
  const nas = await startFakeNas();
  const ai = await startFakeAi('openai-compatible');
  try {
    await assert.rejects(reversePrompt(runtimeOf({ text: ai.slot }), nas.config, item('a')), /视觉模型/);
    const video = item('v', { media: { ...item('v').media, ext: '.mp4', kind: 'video', hasThumb: false } });
    await assert.rejects(reversePrompt(runtimeOf({ vision: ai.slot }), nas.config, video), /没有可以给 AI 看的图片/);
    assert.equal(ai.requests.length, 0);
  } finally {
    nas.server.close();
    ai.server.close();
  }
});

test('Ollama 看图分类：主分类进分类，其余维度和特征并入标签，光线这类维度和不在候选里的名称丢掉，别名换成标准名；库里已有的分类优先', async () => {
  const nas = await startFakeNas();
  const ai = await startFakeAi('ollama');
  try {
    const target = item('a');
    await seed(nas, [target, item('b', { category: '我的人像' })]);
    const { library } = await readLibrary(nas.config);
    const result = await classifyItem(runtimeOf({ vision: ai.slot }), nas.config, target, '', knownCategoriesOf(library));
    assert.deepEqual(result, { category: '肖像摄影', tags: ['少女写真', '黑胶唱片'], warnings: [] });
    assert.equal(ai.requests.length, 2);
    for (const request of ai.requests) {
      assert.equal(request.url, '/api/chat');
      assert.equal(request.body.messages[1].images[0], PNG.toString('base64'));
      // Ollama 默认上下文 4096，装不下带分类目录的提示词，实测会被拒。
      assert.equal(request.body.options.num_ctx, 16384);
    }
    const categoryRequest = ai.requests.find((request) => request.body.messages[0].content.includes('分类识别器'));
    assert.match(categoryRequest.body.messages[0].content, /优先选它作为主分类/);
    assert.match(categoryRequest.body.messages[1].content, /【自定义分类】我的人像/);
  } finally {
    nas.server.close();
    ai.server.close();
  }
});

test('没有视觉模型时按提示词分类；也没有提示词就明确提示', async () => {
  const nas = await startFakeNas();
  const ai = await startFakeAi('openai-compatible');
  try {
    const runtime = runtimeOf({ text: ai.slot });
    await assert.rejects(classifyItem(runtime, nas.config, item('a'), '  ', []), /还没有提示词/);
    const result = await classifyItem(runtime, nas.config, item('a'), '少女在唱片店', knownCategoriesOf({ items: [] }));
    assert.equal(result.category, '肖像摄影');
    assert.ok(ai.requests.every((request) => typeof request.body.messages[1].content === 'string'));
  } finally {
    nas.server.close();
    ai.server.close();
  }
});

test('翻译：有中文就译成英文，正向负向一起译，模型原样返回原文时报错；优化只发当前这段', async () => {
  const ai = await startFakeAi('openai-compatible');
  try {
    const runtime = runtimeOf({ text: ai.slot });
    const translated = await translatePrompt(runtime, '少女挑选唱片', '模糊');
    assert.deepEqual(translated, { prompt: 'a girl picking vinyl records', negativePrompt: 'blurry', targetLanguage: 'en' });
    assert.match(ai.requests[0].body.messages[1].content, /目标语言：English/);
    assert.equal(await optimizePrompt(runtime, 'girl, vinyl', 'negative'), '优化后的提示词');
    assert.match(ai.requests[1].body.messages[0].content, /负向提示词/);
    await assert.rejects(optimizePrompt(runtime, ' ', 'positive'), /空的/);
    await assert.rejects(translatePrompt(runtime, '原样返回这句', '模糊'), /没有翻译，原样返回了原文/);
  } finally {
    ai.server.close();
  }
});

test('批量反推：同组只跑一次，已有提示词的跳过，失败逐条报告，结果写回 NAS', async () => {
  const nas = await startFakeNas();
  const ai = await startFakeAi('openai-compatible');
  try {
    const sameGroup = { title: '组', category: '人像' };
    const video = item('v', { media: { ...item('v').media, ext: '.mp4', kind: 'video', hasThumb: false } });
    await seed(nas, [item('g1', sameGroup), item('g2', sameGroup), item('done', { prompt: '已有' }), video]);
    const progress = [];
    const result = await batchReverse(runtimeOf({ vision: ai.slot }), nas.config, ['g1', 'g2', 'done', 'v'], (entry) => progress.push(entry));
    assert.equal(ai.requests.length, 1);
    assert.deepEqual([result.processed, result.skipped, result.canceled], [1, 1, false]);
    assert.deepEqual(result.failures.map((failure) => failure.name), ['v']);
    const prompts = Object.fromEntries(result.library.items.map((entry) => [entry.id, entry.prompt]));
    assert.deepEqual(prompts, { g1: '少女挑选黑胶唱片，暖色灯光', g2: '少女挑选黑胶唱片，暖色灯光', done: '已有', v: '' });
    assert.deepEqual(progress.map((entry) => entry.task), ['AI 反推', 'AI 反推']);
    assert.equal(nas.locks.size, 0);
  } finally {
    nas.server.close();
    ai.server.close();
  }
});

test('批量分类打标签：分类被 AI 的主分类覆盖，标签并入原有的', async () => {
  const nas = await startFakeNas();
  const ai = await startFakeAi('openai-compatible');
  try {
    await seed(nas, [item('a', { category: '旧分类', tags: ['原有'] })]);
    const result = await batchClassify(runtimeOf({ vision: ai.slot }), nas.config, ['a'], () => {});
    assert.deepEqual([result.processed, result.failures], [1, []]);
    const [updated] = result.library.items;
    assert.equal(updated.category, '肖像摄影');
    assert.deepEqual(updated.tags, ['原有', '少女写真', '黑胶唱片']);
  } finally {
    nas.server.close();
    ai.server.close();
  }
});

test('没有设置任何模型时批量任务直接报错，不动 NAS', async () => {
  const nas = await startFakeNas();
  try {
    await seed(nas, [item('a')]);
    await assert.rejects(batchClassify(runtimeOf({}), nas.config, ['a'], () => {}), /还没有设置 AI 模型/);
    await assert.rejects(batchReverse(runtimeOf({}), nas.config, ['a'], () => {}), /视觉模型/);
  } finally {
    nas.server.close();
  }
});

test('模型列表：Gemini 不会因为名字里有 emi 被当成生图模型（查询模型时不能被过滤掉）', async () => {
  const { parseRemoteModels } = await import('../electron/materials/suyan/remoteAiClient.ts');
  const capabilities = Object.fromEntries(
    parseRemoteModels({
      data: [{ id: 'gemini-3-flash' }, { id: 'gemini-3.5-flash-lite' }, { id: 'emi-2' }, { id: 'gpt-image-2' }],
    }).map((model) => [model.id, model.capabilities]),
  );
  assert.deepEqual(capabilities['gemini-3-flash'], ['text', 'vision']);
  assert.deepEqual(capabilities['gemini-3.5-flash-lite'], ['text', 'vision']);
  assert.deepEqual(capabilities['emi-2'], ['image-generation']);
  assert.deepEqual(capabilities['gpt-image-2'], ['image-generation']);
});
