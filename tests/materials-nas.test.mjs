import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { mutateLibrary, readLibrary } = await import('../electron/materials/libraryStore.ts');
const { davUrl, normalizeBaseUrl } = await import('../electron/materials/webdav.ts');

// 照 fnOS 实测行为写的 WebDAV：认 Basic 账户和 LOCK（别人持锁时 423，带 If 令牌才能写），完全忽略 If-Match。
function startFakeNas() {
  const files = new Map();
  const locks = new Map();
  let nextToken = 1;
  const server = http.createServer((request, response) => {
    if (request.headers.authorization !== `Basic ${Buffer.from('user:pass').toString('base64')}`) {
      response.writeHead(401).end();
      return;
    }
    const key = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const lockToken = locks.get(key);
      switch (request.method) {
        case 'PROPFIND':
          response.writeHead(files.has(key) || key.endsWith('/') ? 207 : 404).end();
          return;
        case 'GET':
          if (!files.has(key)) return response.writeHead(404).end();
          response.writeHead(200).end(files.get(key));
          return;
        case 'PUT':
          if (lockToken && request.headers.if !== `(${lockToken})`) return response.writeHead(423).end();
          files.set(key, body);
          response.writeHead(201).end();
          return;
        case 'LOCK':
          if (lockToken) return response.writeHead(423).end();
          locks.set(key, `<t${nextToken++}>`);
          if (!files.has(key)) files.set(key, Buffer.alloc(0));
          response.writeHead(200, { 'Lock-Token': locks.get(key) }).end();
          return;
        case 'UNLOCK':
          locks.delete(key);
          response.writeHead(204).end();
          return;
        default:
          response.writeHead(405).end();
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const baseUrl = `http://127.0.0.1:${server.address().port}/团队文件-素材/`;
      resolve({ files, locks, server, config: { baseUrl, username: 'user', password: 'pass' } });
    });
  });
}

const sha = (n) => String(n).padStart(64, '0');
const item = (id) => ({
  id,
  title: id,
  prompt: '',
  negativePrompt: '',
  category: '',
  tags: [],
  favorite: false,
  media: { sha256: sha(id), ext: '.png', kind: 'image', name: `${id}.png`, size: 1, width: 1, height: 1, hasThumb: false },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});
const addOne = (id) => (library) => ({ library: { ...library, items: [...library.items, item(id)] }, result: id });

test('地址统一成以 / 结尾，中文目录名正确编码', () => {
  assert.equal(normalizeBaseUrl('https://nas.example:5016/团队文件-素材'), 'https://nas.example:5016/%E5%9B%A2%E9%98%9F%E6%96%87%E4%BB%B6-%E7%B4%A0%E6%9D%90/');
  assert.equal(davUrl({ baseUrl: 'https://nas.example/a' }, 'media/x.png'), 'https://nas.example/a/media/x.png');
  assert.throws(() => normalizeBaseUrl('ftp://nas'), /https/);
});

test('NAS 上还没有 library.json 时读到空库', async () => {
  const nas = await startFakeNas();
  try {
    const { library, dropped } = await readLibrary(nas.config);
    assert.deepEqual([library.items, dropped], [[], 0]);
  } finally {
    nas.server.close();
  }
});

test('两台电脑同时写入，两边的改动都保留，锁最后都释放', async () => {
  const nas = await startFakeNas();
  try {
    const results = await Promise.all([mutateLibrary(nas.config, addOne('1')), mutateLibrary(nas.config, addOne('2'))]);
    assert.deepEqual(results.map((entry) => entry.result).sort(), ['1', '2']);
    const { library } = await readLibrary(nas.config);
    assert.deepEqual(library.items.map((entry) => entry.id).sort(), ['1', '2']);
    assert.equal(nas.locks.size, 0);
  } finally {
    nas.server.close();
  }
});

test('library.json 损坏时停止写入，不覆盖原文件，并解锁', async () => {
  const nas = await startFakeNas();
  try {
    nas.files.set('/团队文件-素材/library.json', Buffer.from('{ broken'));
    await assert.rejects(mutateLibrary(nas.config, addOne('1')), /不是有效的 JSON/);
    assert.equal(nas.files.get('/团队文件-素材/library.json').toString(), '{ broken');
    assert.equal(nas.locks.size, 0);
  } finally {
    nas.server.close();
  }
});

test('改动函数出错时不写入，并解锁', async () => {
  const nas = await startFakeNas();
  try {
    await mutateLibrary(nas.config, addOne('1'));
    await assert.rejects(
      mutateLibrary(nas.config, () => {
        throw new Error('这条素材已经不存在');
      }),
      /不存在/,
    );
    assert.deepEqual((await readLibrary(nas.config)).library.items.map((entry) => entry.id), ['1']);
    assert.equal(nas.locks.size, 0);
  } finally {
    nas.server.close();
  }
});

test('密码不对时给出明确提示', async () => {
  const nas = await startFakeNas();
  try {
    await assert.rejects(readLibrary({ ...nas.config, password: 'wrong' }), /用户名或密码不对/);
  } finally {
    nas.server.close();
  }
});
