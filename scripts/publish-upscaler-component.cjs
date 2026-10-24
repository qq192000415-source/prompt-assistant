// 把来图定制「高清放大」用的 Real-ESRGAN（ncnn-vulkan，BSD-3）重新打包后上传到更新源的 components/ 子目录，只在换版本时手动运行一次：
//   node scripts/publish-upscaler-component.cjs <官方 realesrgan-ncnn-vulkan-*-windows.zip> <Real-ESRGAN 仓库的 LICENSE 文件>
// 只留程序、两个 dll 和照片（realesrgan-x4plus）、插画（realesrgan-x4plus-anime）两个模型；zip 里的时间固定、文件排序，内容不变时 SHA256 不变。
// 上传后把打印出的文件名、大小、SHA256 写进 electron/materials/upscaler.ts 的 UPSCALER_COMPONENT。
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const { loadEnvFile } = require('./load-env-file.cjs');

const projectRoot = path.resolve(__dirname, '..');
const fileEnv = loadEnvFile(path.join(projectRoot, '.env'));
const readConfig = (name) => (process.env[name] || fileEnv[name] || '').trim();
const sshHost = readConfig('UPDATE_SERVER_HOST');
const sshUser = readConfig('UPDATE_SERVER_USER');
const sshKeyPath = readConfig('UPDATE_SERVER_SSH_KEY');
const remoteDir = `${(readConfig('UPDATE_SERVER_REMOTE_DIR') || '/opt/prompt-assistant-updates/win').replace(/\/+$/, '')}/components`;
const updateBaseUrl = readConfig('UPDATE_BASE_URL').replace(/\/+$/, '');

const KEEP = [
  'realesrgan-ncnn-vulkan.exe',
  'vcomp140.dll',
  'vcomp140d.dll',
  'models/realesrgan-x4plus.bin',
  'models/realesrgan-x4plus.param',
  'models/realesrgan-x4plus-anime.bin',
  'models/realesrgan-x4plus-anime.param',
  'README_windows.md',
];
const FIXED_DATE = new Date('2022-04-24T00:00:00Z');

const keyArgs = ['-i', sshKeyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} 失败：${(result.stderr || result.stdout).trim()}`);
};
const head = (url) =>
  new Promise((resolve, reject) => {
    https
      .request(url, { method: 'HEAD', timeout: 30000 }, (response) => {
        response.resume();
        resolve({ status: response.statusCode, size: Number(response.headers['content-length'] || 0) });
      })
      .on('error', reject)
      .end();
  });

const main = async () => {
  const [officialZip, licenseFile] = process.argv.slice(2).map((arg) => path.resolve(arg || ''));
  const version = (path.basename(officialZip).match(/realesrgan-ncnn-vulkan-(\d+)-windows\.zip$/) || [])[1];
  if (!version) throw new Error('第一个参数要是官方的 realesrgan-ncnn-vulkan-<日期>-windows.zip');
  if (!fs.readFileSync(licenseFile, 'utf8').includes('BSD 3-Clause')) throw new Error('第二个参数要是 Real-ESRGAN 的 LICENSE（BSD 3-Clause）');
  for (const [name, value] of [['UPDATE_SERVER_HOST', sshHost], ['UPDATE_SERVER_USER', sshUser], ['UPDATE_SERVER_SSH_KEY', sshKeyPath], ['UPDATE_BASE_URL', updateBaseUrl]]) {
    if (!value) throw new Error(`缺少 ${name}，在 .env 里配置`);
  }

  const official = await JSZip.loadAsync(fs.readFileSync(officialZip));
  const packed = new JSZip();
  for (const name of KEEP) {
    const entry = official.file(name);
    if (!entry) throw new Error(`官方包里没有 ${name}`);
    packed.file(name, await entry.async('nodebuffer'), { date: FIXED_DATE });
  }
  packed.file('LICENSE.txt', fs.readFileSync(licenseFile), { date: FIXED_DATE });
  const bytes = await packed.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' });

  const name = `realesrgan-ncnn-vulkan-${version}-x4plus.zip`;
  const local = path.join(os.tmpdir(), name);
  fs.writeFileSync(local, bytes);
  run('ssh', [...keyArgs, `${sshUser}@${sshHost}`, `mkdir -p '${remoteDir}' && chmod 755 '${remoteDir}'`]);
  run('scp', [...keyArgs, local, `${sshUser}@${sshHost}:${remoteDir}/${name}`]);
  run('ssh', [...keyArgs, `${sshUser}@${sshHost}`, `chmod 644 '${remoteDir}/${name}'`]);
  const remote = await head(`${updateBaseUrl}/components/${encodeURIComponent(name)}`);
  if (remote.status !== 200 || remote.size !== bytes.length) throw new Error(`${name} 公网校验失败：HTTP ${remote.status}，大小 ${remote.size}，应为 ${bytes.length}`);
  fs.rmSync(local, { force: true });
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  console.log(`[upscaler-component] 已上传并校验 components/${name}（${bytes.length} 字节）`);
  console.log(`[upscaler-component] UPSCALER_COMPONENT = { file: 'components/${name}', size: ${bytes.length}, sha256: '${sha256}' }`);
};

main().catch((error) => {
  console.error(`[upscaler-component] ${error.message || error}`);
  process.exitCode = 1;
});
