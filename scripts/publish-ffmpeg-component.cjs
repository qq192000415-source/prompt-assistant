// 把素材库视频压缩用的 FFmpeg 上传到更新源的 components/ 子目录，只在更换 FFmpeg 版本时手动运行一次：
//   node scripts/publish-ffmpeg-component.cjs <解压后的 ffmpeg 目录>
// 目录里要有 bin/ffmpeg.exe、LICENSE、README.txt（gyan.dev essentials 构建的原样结构）。
// 放子目录是因为 publish-update-to-server.cjs 发版时会清掉更新目录根下的旧 .exe。
// 上传后把打印出的文件名、大小、SHA256 写进 electron/materials/ffmpeg.ts 的 FFMPEG_COMPONENT。
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadEnvFile } = require('./load-env-file.cjs');

const projectRoot = path.resolve(__dirname, '..');
const fileEnv = loadEnvFile(path.join(projectRoot, '.env'));
const readConfig = (name) => (process.env[name] || fileEnv[name] || '').trim();
const sshHost = readConfig('UPDATE_SERVER_HOST');
const sshUser = readConfig('UPDATE_SERVER_USER');
const sshKeyPath = readConfig('UPDATE_SERVER_SSH_KEY');
const remoteDir = `${(readConfig('UPDATE_SERVER_REMOTE_DIR') || '/opt/prompt-assistant-updates/win').replace(/\/+$/, '')}/components`;
const updateBaseUrl = readConfig('UPDATE_BASE_URL').replace(/\/+$/, '');

const sourceDir = path.resolve(process.argv[2] || '');
const version = (fs.readFileSync(path.join(sourceDir, 'README.txt'), 'utf8').match(/^Version:\s*(\S+)/m) || [])[1];
if (!version) throw new Error('README.txt 里没有 Version 行，确认目录是 gyan.dev 的 FFmpeg 构建');

const base = `ffmpeg-${version}`;
const files = [
  { local: path.join(sourceDir, 'bin', 'ffmpeg.exe'), name: `${base}.exe` },
  { local: path.join(sourceDir, 'LICENSE'), name: `${base}-LICENSE.txt` },
  { local: path.join(sourceDir, 'README.txt'), name: `${base}-README.txt` },
];

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
  for (const [name, value] of [['UPDATE_SERVER_HOST', sshHost], ['UPDATE_SERVER_USER', sshUser], ['UPDATE_SERVER_SSH_KEY', sshKeyPath], ['UPDATE_BASE_URL', updateBaseUrl]]) {
    if (!value) throw new Error(`缺少 ${name}，在 .env 里配置`);
  }
  run('ssh', [...keyArgs, `${sshUser}@${sshHost}`, `mkdir -p '${remoteDir}' && chmod 755 '${remoteDir}'`]);
  for (const file of files) {
    run('scp', [...keyArgs, file.local, `${sshUser}@${sshHost}:${remoteDir}/${file.name}`]);
    run('ssh', [...keyArgs, `${sshUser}@${sshHost}`, `chmod 644 '${remoteDir}/${file.name}'`]);
    const size = fs.statSync(file.local).size;
    const remote = await head(`${updateBaseUrl}/components/${encodeURIComponent(file.name)}`);
    if (remote.status !== 200 || remote.size !== size) {
      throw new Error(`${file.name} 公网校验失败：HTTP ${remote.status}，大小 ${remote.size}，应为 ${size}`);
    }
    console.log(`[ffmpeg-component] 已上传并校验 components/${file.name}（${size} 字节）`);
  }
  const exe = files[0];
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exe.local)).digest('hex');
  console.log(`[ffmpeg-component] FFMPEG_COMPONENT = { file: 'components/${exe.name}', size: ${fs.statSync(exe.local).size}, sha256: '${sha256}' }`);
};

main().catch((error) => {
  console.error(`[ffmpeg-component] ${error.message || error}`);
  process.exitCode = 1;
});
