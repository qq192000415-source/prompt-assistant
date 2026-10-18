import http from 'node:http';

// 照 fnOS 实测行为写的 WebDAV：认 Basic 账户和 LOCK（别人持锁时 423，带 If 令牌才能写），完全忽略 If-Match。
export function startFakeNas() {
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
