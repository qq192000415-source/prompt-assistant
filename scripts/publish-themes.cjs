// 把主题市场（themes/index.json 和 themes/dist/）上传到更新服务器的 themes/ 子目录，软件优先从这里读，读不到再读 GitHub。
//   node scripts/build-theme-index.cjs && node scripts/publish-themes.cjs   （npm.cmd run themes:publish）
// 改了 themes/ 下的皮肤才需要跑。放子目录是因为 publish-update-to-server.cjs 发版时会清掉更新目录根下的旧 .exe。
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
const remoteDir = `${(readConfig('UPDATE_SERVER_REMOTE_DIR') || '/opt/prompt-assistant-updates/win').replace(/\/+$/, '')}/themes`;
const updateBaseUrl = readConfig('UPDATE_BASE_URL').replace(/\/+$/, '');
const themesDir = path.join(projectRoot, 'themes');

const keyArgs = ['-i', sshKeyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} 失败：${(result.stderr || result.stdout).trim()}`);
};
const ssh = (script) => run('ssh', [...keyArgs, `${sshUser}@${sshHost}`, script]);

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
  const index = JSON.parse(fs.readFileSync(path.join(themesDir, 'index.json'), 'utf8'));
  const files = ['index.json', ...index.themes.flatMap((theme) => [`dist/${theme.id}.zip`, theme.preview])];
  for (const file of files) {
    if (!fs.existsSync(path.join(themesDir, file))) throw new Error(`themes/${file} 不存在，先跑 node scripts/build-theme-index.cjs`);
  }
  // 先传新 dist 到临时目录再整体换上，传到一半时线上仍是旧的一套
  ssh(`rm -rf '${remoteDir}/dist.new' && mkdir -p '${remoteDir}/dist.new' && chmod 755 '${remoteDir}' '${remoteDir}/dist.new'`);
  for (const file of files.filter((name) => name.startsWith('dist/'))) {
    run('scp', [...keyArgs, path.join(themesDir, file), `${sshUser}@${sshHost}:${remoteDir}/dist.new/${path.basename(file)}`]);
  }
  ssh(`chmod 644 '${remoteDir}/dist.new/'* && rm -rf '${remoteDir}/dist' && mv '${remoteDir}/dist.new' '${remoteDir}/dist'`);
  run('scp', [...keyArgs, path.join(themesDir, 'index.json'), `${sshUser}@${sshHost}:${remoteDir}/index.json`]);
  ssh(`chmod 644 '${remoteDir}/index.json'`);
  for (const file of files) {
    const size = fs.statSync(path.join(themesDir, file)).size;
    const remote = await head(`${updateBaseUrl}/themes/${file}`);
    if (remote.status !== 200 || remote.size !== size) throw new Error(`themes/${file} 公网校验失败：HTTP ${remote.status}，大小 ${remote.size}，应为 ${size}`);
    console.log(`[themes] 已上传并校验 themes/${file}（${size} 字节）`);
  }
};

main().catch((error) => {
  console.error(`[themes] ${error.message || error}`);
  process.exitCode = 1;
});
