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

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    windowsHide: true,
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

  const installerName = manifestInstallerName || exeFiles[0]?.name;
  if (!installerName) {
    throw new Error(`No installer exe found in ${releaseDir}`);
  }

  const installerPath = path.join(releaseDir, installerName);
  if (!fs.existsSync(installerPath)) {
    throw new Error(`latest.yml points to missing installer: ${installerName}`);
  }

  const installerSize = fs.statSync(installerPath).size;
  const manifestSize = manifestSizeMatch ? Number(manifestSizeMatch[1]) : installerSize;
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
