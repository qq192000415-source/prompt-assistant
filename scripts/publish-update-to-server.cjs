const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadEnvFile } = require('./load-env-file.cjs');

const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.resolve(process.env.RELEASE_DIR || path.join(projectRoot, 'release'));
const latestPath = path.join(releaseDir, 'latest.yml');
const fileEnv = loadEnvFile(path.join(projectRoot, '.env'));
const readConfig = (name) => (process.env[name] || fileEnv[name] || '').trim();
const sshHost = readConfig('UPDATE_SERVER_HOST');
const sshUser = readConfig('UPDATE_SERVER_USER');
const sshKeyPath = readConfig('UPDATE_SERVER_SSH_KEY');
const remoteDir = (readConfig('UPDATE_SERVER_REMOTE_DIR') || '/opt/prompt-assistant-updates/win').replace(/\/+$/, '');
const updateBaseUrl = readConfig('UPDATE_BASE_URL').replace(/\/+$/, '');
// 1.16.0：安装包另传一份到公开仓库的 GitHub Releases（英文文件名，GitHub 会改掉中文名），latest.yml 里写上经国内镜像的下载地址，
// 软件按顺序试，最后才用自己的服务器（electron/updateSources.cjs）。没配 UPDATE_GITHUB_REPO 就跳过，只用自己的服务器。
const githubRepo = readConfig('UPDATE_GITHUB_REPO');
// 2026-10-21 在 NAS（国内电信宽带）实测 12.5MB：ghfast.top 1.7MB/s、gh-proxy.com 0.7MB/s、cors.isteed.cc 0.6MB/s，
// GitHub 直连不通、自己的服务器 72KB/s，另外 10 个镜像不通或更慢。镜像挂了改这里再发一次清单就行，软件不用升级。
// 最后的空前缀是 GitHub 直连，给开了代理的用户。
const DOWNLOAD_MIRROR_PREFIXES = ['https://ghfast.top/', 'https://gh-proxy.com/', 'https://cors.isteed.cc/', ''];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    windowsHide: true,
    env: options.env,
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${details ? `:\n${details}` : ''}`);
  }
  return result.stdout || '';
};

const sshArgs = (...remoteCommand) => [
  '-i',
  sshKeyPath,
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=accept-new',
  `${sshUser}@${sshHost}`,
  ...remoteCommand,
];

const scpArgs = (...args) => [
  '-i',
  sshKeyPath,
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=accept-new',
  ...args,
];

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

const readReleaseManifest = () => {
  if (!fs.existsSync(latestPath)) {
    throw new Error(`Missing release metadata: ${latestPath}`);
  }

  const latestYaml = fs.readFileSync(latestPath, 'utf8');
  const manifestPathMatch = latestYaml.match(/^path:\s*(.+)$/m);
  const manifestSizeMatch = latestYaml.match(/^\s*size:\s*(\d+)\s*$/m);
  const manifestInstallerName = manifestPathMatch
    ? manifestPathMatch[1].trim().replace(/^['"]|['"]$/g, '')
    : '';

  const exeFiles = fs
    .readdirSync(releaseDir)
    .filter((name) => name.endsWith('.exe'))
    .map((name) => ({
      name,
      size: fs.statSync(path.join(releaseDir, name)).size,
    }))
    .sort((a, b) => b.size - a.size);

  let installerName = manifestInstallerName || exeFiles[0]?.name;
  if (!installerName) {
    throw new Error(`No installer exe found in ${releaseDir}`);
  }

  const declaredSize = manifestSizeMatch ? Number(manifestSizeMatch[1]) : null;
  let installerPath = path.join(releaseDir, installerName);
  if (!fs.existsSync(installerPath)) {
    const sizedMatches = exeFiles.filter((file) => declaredSize != null && file.size === declaredSize);
    if (sizedMatches.length !== 1) {
      throw new Error(`latest.yml points to missing installer: ${installerName}`);
    }

    const realName = sizedMatches[0].name;
    fs.writeFileSync(latestPath, latestYaml.replaceAll(installerName, realName));
    installerName = realName;
    installerPath = path.join(releaseDir, installerName);
  }

  const installerSize = fs.statSync(installerPath).size;
  const manifestSize = declaredSize ?? installerSize;
  if (manifestSize !== installerSize) {
    throw new Error(
      `latest.yml size (${manifestSize}) does not match installer size (${installerSize}): ${installerName}`,
    );
  }

  const blockmapName = `${installerName}.blockmap`;
  const blockmapPath = path.join(releaseDir, blockmapName);
  if (!fs.existsSync(blockmapPath)) {
    throw new Error(`Missing installer blockmap: ${blockmapPath}`);
  }

  return {
    files: [
      { name: installerName, localPath: installerPath, size: installerSize, method: 'HEAD' },
      { name: blockmapName, localPath: blockmapPath, size: fs.statSync(blockmapPath).size, method: 'HEAD' },
      { name: 'latest.yml', localPath: latestPath, size: fs.statSync(latestPath).size, method: 'GET' },
    ],
    installerName,
  };
};

const ensureLocalPrerequisites = () => {
  const missing = [
    ['UPDATE_SERVER_HOST', sshHost],
    ['UPDATE_SERVER_USER', sshUser],
    ['UPDATE_SERVER_SSH_KEY', sshKeyPath],
    ['UPDATE_BASE_URL', updateBaseUrl],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')}. Set them in the environment or .env before publishing.`);
  }

  if (!fs.existsSync(sshKeyPath)) {
    throw new Error(`SSH key not found: ${sshKeyPath}`);
  }
};

const ensureRemoteDirectory = () => {
  run(
    'ssh',
    sshArgs(
      `sudo mkdir -p ${shellQuote(remoteDir)} && sudo chown ${shellQuote(sshUser)}:${shellQuote(sshUser)} ${shellQuote(
        remoteDir,
      )} && chmod 755 ${shellQuote(remoteDir)}`,
    ),
  );
};

// gh 没单独登录时，借用 git 推送用的 GitHub 凭据（Windows 凭据管理器），只放进 gh 进程的环境变量，不写文件。
const githubEnv = () => {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env;
  if (spawnSync('gh', ['auth', 'status'], { windowsHide: true }).status === 0) return process.env;
  const credential = spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true });
  const token = credential.stdout?.match(/^password=(.+)$/m)?.[1]?.trim();
  if (!token) throw new Error('GitHub 没登录：运行 gh auth login，或先让 git 能推送到 GitHub');
  return { ...process.env, GH_TOKEN: token };
};

// 传到 GitHub Releases（tag v<版本>，已有就覆盖同名文件），再把镜像地址写进 latest.yml（重复跑会先去掉旧的那段）。
const publishGithubMirror = async (release) => {
  if (!githubRepo) {
    console.log('[publish-update] UPDATE_GITHUB_REPO is empty, skip GitHub mirror.');
    return;
  }
  const version = fs.readFileSync(latestPath, 'utf8').match(/^version:\s*(\S+)/m)?.[1];
  if (!version) throw new Error('latest.yml has no version');
  const tag = `v${version}`;
  const assetName = `MuseBox-Setup-${version}.exe`;
  const installer = release.files[0];
  const assetDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'github-asset-'));
  const assetPath = path.join(assetDir, assetName);
  fs.copyFileSync(installer.localPath, assetPath);
  try {
    const env = githubEnv();
    const exists = spawnSync('gh', ['release', 'view', tag, '--repo', githubRepo], { encoding: 'utf8', windowsHide: true, env }).status === 0;
    if (exists) run('gh', ['release', 'upload', tag, assetPath, '--repo', githubRepo, '--clobber'], { env });
    else run('gh', ['release', 'create', tag, assetPath, '--repo', githubRepo, '--title', `灵匣 ${version}`, '--notes', `灵匣 ${version} 安装版。软件内自动更新会从这里经国内镜像下载，校验值以更新服务器上的 latest.yml 为准。`], { env });
  } finally {
    fs.rmSync(assetDir, { recursive: true, force: true });
  }
  const githubUrl = `https://github.com/${githubRepo}/releases/download/${tag}/${assetName}`;
  const response = await fetch(githubUrl, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  const size = Number(response.headers.get('content-length') || 0);
  if (!response.ok || size !== installer.size) throw new Error(`GitHub asset check failed: HTTP ${response.status}, size ${size} !== ${installer.size}`);
  console.log(`[publish-update] GitHub release ${tag}: ${assetName}`);

  const mirrors = DOWNLOAD_MIRROR_PREFIXES.map((prefix) => `${prefix}${githubUrl}`);
  const yaml = fs.readFileSync(latestPath, 'utf8').replace(/^downloadMirrors:\n(?:\s+- .*\n?)*/m, '');
  fs.writeFileSync(latestPath, `${yaml.replace(/\n*$/, '\n')}downloadMirrors:\n${mirrors.map((url) => `  - ${url}\n`).join('')}`);
  release.files.find((file) => file.name === 'latest.yml').size = fs.statSync(latestPath).size;
  console.log(`[publish-update] latest.yml downloadMirrors: ${mirrors.length}`);
};

const uploadReleaseFiles = (release) => {
  for (const file of release.files) {
    run('scp', scpArgs(file.localPath, `${sshUser}@${sshHost}:${remoteDir}/${file.name}`), { stdio: 'pipe' });
    console.log(`[publish-update] Uploaded ${file.name}`);
  }
};

const removeOldRemoteArtifacts = (release) => {
  const keepNameFilters = release.files
    .filter((file) => file.name.endsWith('.exe') || file.name.endsWith('.blockmap'))
    .map((file) => `! -name ${shellQuote(file.name)}`)
    .join(' ');
  const chmodTargets = release.files.map((file) => shellQuote(file.name)).join(' ');
  const command = [
    `cd ${shellQuote(remoteDir)}`,
    `find . -maxdepth 1 -type f \\( -name '*.exe' -o -name '*.blockmap' \\) ${keepNameFilters} -delete`,
    `chmod 644 -- ${chmodTargets}`,
  ].join(' && ');
  run('ssh', sshArgs(command));
};

const verifyHttpFile = (file) =>
  new Promise((resolve, reject) => {
    const url = `${updateBaseUrl}/${encodeURIComponent(file.name)}`;
    const transport = url.startsWith('https:') ? https : http;
    const request = transport.request(url, { method: file.method, timeout: 30000 }, (response) => {
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
      });
      response.on('end', () => {
        const contentLength = Number(response.headers['content-length'] || bytes || 0);
        if (response.statusCode !== 200) {
          reject(new Error(`${file.name} returned HTTP ${response.statusCode}`));
          return;
        }
        if (contentLength !== file.size) {
          reject(new Error(`${file.name} size mismatch over HTTP: ${contentLength} !== ${file.size}`));
          return;
        }
        resolve();
      });
    });

    request.on('timeout', () => request.destroy(new Error(`HTTP verification timed out: ${file.name}`)));
    request.on('error', reject);
    request.end();
  });

const main = async () => {
  const release = readReleaseManifest();
  ensureLocalPrerequisites();

  console.log(`[publish-update] Server: ${sshUser}@${sshHost}`);
  console.log(`[publish-update] Remote directory: ${remoteDir}`);
  console.log(`[publish-update] Update URL: ${updateBaseUrl}`);
  console.log(`[publish-update] Installer: ${release.installerName}`);

  await publishGithubMirror(release);
  ensureRemoteDirectory();
  uploadReleaseFiles(release);
  removeOldRemoteArtifacts(release);

  for (const file of release.files) {
    await verifyHttpFile(file);
    console.log(`[publish-update] Verified ${file.name}`);
  }

  console.log('[publish-update] Done.');
};

main().catch((error) => {
  console.error(`[publish-update] ${error.message || error}`);
  process.exitCode = 1;
});
