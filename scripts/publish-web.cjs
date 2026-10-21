// 把网页版（dist/）经 WebDAV 传到飞牛 NAS 团队文件夹「灵匣网页版」的 site/，Caddy 容器直接读这个目录，不用重启。
//   npm.cmd run build && node scripts/publish-web.cjs   （npm.cmd run web:publish）
// 顺序：先传带哈希的资源，最后换 index.html，再删旧版本留下的资源，发布中途打开网页也不会缺文件。
// 部署账号只对这个团队文件夹有读写权限，地址、账号、密码在 .env 的 WEB_DEPLOY_DAV_*；公网地址是 VITE_WEB_URL。
const fs = require('node:fs');
const path = require('node:path');
const { loadEnvFile } = require('./load-env-file.cjs');

const projectRoot = path.resolve(__dirname, '..');
const fileEnv = loadEnvFile(path.join(projectRoot, '.env'));
const readConfig = (name) => (process.env[name] || fileEnv[name] || '').trim();
const davUrl = readConfig('WEB_DEPLOY_DAV_URL').replace(/\/*$/, '/');
const davUser = readConfig('WEB_DEPLOY_DAV_USER');
const davPassword = readConfig('WEB_DEPLOY_DAV_PASSWORD');
const webUrl = readConfig('VITE_WEB_URL').replace(/\/+$/, '');
const distDir = path.join(projectRoot, 'dist');
const auth = `Basic ${Buffer.from(`${davUser}:${davPassword}`).toString('base64')}`;

const dav = async (method, relative, { body, headers = {}, ok = [200, 201, 204, 207] } = {}) => {
  const response = await fetch(new URL(`site/${relative}`, davUrl), { method, body, headers: { authorization: auth, ...headers }, signal: AbortSignal.timeout(120_000) });
  if (!ok.includes(response.status)) throw new Error(`${method} site/${relative} 失败：HTTP ${response.status}`);
  return response;
};

const listLocal = (dir, prefix = '') =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`;
    return entry.isDirectory() ? [`${relative}/`, ...listLocal(path.join(dir, entry.name), `${relative}/`)] : [relative];
  });

// PROPFIND 列出 site/ 下已有的全部文件（fnOS 支持 Depth: infinity）。
const listRemote = async () => {
  const xml = await (await dav('PROPFIND', '', { headers: { depth: 'infinity' } })).text();
  const root = new URL('site/', davUrl).pathname;
  return [...xml.matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/g)]
    .map((match) => decodeURIComponent(new URL(match[1], davUrl).pathname))
    .filter((pathname) => pathname.startsWith(decodeURIComponent(root)) && pathname !== decodeURIComponent(root))
    .map((pathname) => pathname.slice(decodeURIComponent(root).length));
};

const encodePath = (relative) => relative.split('/').map(encodeURIComponent).join('/');

const main = async () => {
  for (const [name, value] of [['WEB_DEPLOY_DAV_URL', davUrl], ['WEB_DEPLOY_DAV_USER', davUser], ['WEB_DEPLOY_DAV_PASSWORD', davPassword], ['VITE_WEB_URL', webUrl]]) {
    if (!value || value === '/') throw new Error(`缺少 ${name}，在 .env 里配置`);
  }
  if (!fs.existsSync(path.join(distDir, 'index.html'))) throw new Error('dist/index.html 不存在，先 npm.cmd run build');

  const local = listLocal(distDir);
  const files = local.filter((relative) => !relative.endsWith('/') && relative !== 'index.html');
  for (const dir of local.filter((relative) => relative.endsWith('/'))) await dav('MKCOL', encodePath(dir), { ok: [201, 405] });
  for (const relative of files) await dav('PUT', encodePath(relative), { body: fs.readFileSync(path.join(distDir, relative)) });
  await dav('PUT', 'index.html', { body: fs.readFileSync(path.join(distDir, 'index.html')) });
  console.log(`[web] 已上传 ${files.length + 1} 个文件`);

  const keep = new Set(local);
  const stale = (await listRemote()).filter((relative) => !keep.has(relative) && !relative.endsWith('/'));
  for (const relative of stale) await dav('DELETE', encodePath(relative), { ok: [204, 404] });
  if (stale.length) console.log(`[web] 已删除旧文件 ${stale.length} 个`);

  const page = await fetch(`${webUrl}/`, { signal: AbortSignal.timeout(30_000) });
  const html = await page.text();
  if (!page.ok || html !== fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')) throw new Error(`公网校验失败：${webUrl}/ 返回 HTTP ${page.status}，内容和本次上传的 index.html 不一致`);
  console.log(`[web] 公网校验通过：${webUrl}/`);
};

main().catch((error) => {
  console.error(`[web] ${error.message}`);
  process.exitCode = 1;
});
