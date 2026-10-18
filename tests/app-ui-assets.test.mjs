import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const readText = (...segments) => readFileSync(join(rootDir, ...segments), 'utf8');
const readBytes = (...segments) => readFileSync(join(rootDir, ...segments));
// 界面源码分在 App.tsx 和 src/components/ 下；按“整个界面里有没有”来断言，不绑定具体文件。
const readUiSource = () =>
  [
    readText('src', 'App.tsx'),
    ...readdirSync(join(rootDir, 'src', 'components'))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => readText('src', 'components', name)),
  ].join('\n');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('应用版本、窗口标题和打包文件名保持一致', () => {
  const packageJson = JSON.parse(readText('package.json'));
  const version = packageJson.version;

  assert.equal(packageJson.productName, `提示词助手${version}`);
  assert.equal(packageJson.build.productName, `提示词助手${version}`);
  assert.equal(packageJson.build.artifactName, `提示词助手安装版${version}.\${ext}`);
  assert.equal(packageJson.build.portable.artifactName, `提示词助手便携版${version}.\${ext}`);
  // 快捷方式名不带版本号：升级时覆盖同一个快捷方式，不留下指向旧 exe 的失效快捷方式（会让任务栏图标变白）。
  assert.equal(packageJson.build.nsis.shortcutName, '提示词助手');
  assert.equal(JSON.parse(readText('package-lock.json')).version, version);

  assert.match(readText('src', 'appMeta.ts'), /packageInfo\.version/);
  assert.match(readText('electron', 'main.cjs'), /const \{ version: appVersion \} = require\('\.\.\/package\.json'\);/);
  assert.match(readText('index.html'), new RegExp(`<title>提示词助手${escapeRegExp(version)}</title>`));
  assert.match(readText('scripts', 'clean-release.cjs'), /const \{ version: appVersion \} = require\('\.\.\/package\.json'\);/);
  assert.match(readText('scripts', 'clean-release.cjs'), /提示词助手安装版\$\{appVersion\}\.exe/);
  assert.match(readText('scripts', 'clean-release.cjs'), /提示词助手安装版\$\{appVersion\}\.exe\.blockmap/);
  assert.match(readText('scripts', 'clean-release.cjs'), /提示词助手便携版\$\{appVersion\}\.exe/);
  assert.match(readText('scripts', 'clean-release.cjs'), /'latest\.yml'/);
});

test('release 清理规则保留文件夹版输出', () => {
  const packageJson = JSON.parse(readText('package.json'));
  const cleanReleaseScript = readText('scripts', 'clean-release.cjs');
  const packageAllScript = packageJson.scripts['package:all'];

  assert.match(cleanReleaseScript, /latestDirectories = new Set\(\['win-unpacked'\]\)/);
  assert.match(cleanReleaseScript, /latestDirectories\.has\(entry\)/);
  assert.match(packageAllScript, /electron-builder --win portable nsis dir --x64 --publish never/);
  assert.ok(packageJson.scripts['package:unpacked'].includes('electron-builder --win dir --x64'));
  assert.equal(packageJson.scripts['package:release'], 'npm run package:all');
});

test('server update publisher reads the deployer server from env', () => {
  const publishScript = readText('scripts', 'publish-update-to-server.cjs');

  assert.match(publishScript, /UPDATE_SERVER_HOST/);
  assert.match(publishScript, /UPDATE_SERVER_USER/);
  assert.match(publishScript, /UPDATE_SERVER_SSH_KEY/);
  assert.match(publishScript, /UPDATE_BASE_URL/);
  assert.match(publishScript, /Missing /);
  assert.match(publishScript, /prompt-assistant-updates/);
  assert.match(publishScript, /ensureRemoteDirectory/);
  assert.match(publishScript, /uploadReleaseFiles/);
  assert.match(publishScript, /removeOldRemoteArtifacts/);
  assert.match(publishScript, /verifyHttpFile/);
  assert.match(publishScript, /scp/);
  assert.match(publishScript, /find \. -maxdepth 1/);
  assert.doesNotMatch(publishScript, /\.pem/);
  assert.doesNotMatch(publishScript, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(publishScript, /createClient/);
  assert.throws(() => readText('scripts', 'publish-update-to-supabase.cjs'));
});

test('desktop updater uses the deployer generic feed', () => {
  const packageJson = JSON.parse(readText('package.json'));
  const mainProcess = readText('electron', 'main.cjs');
  const preload = readText('electron', 'preload.cjs');
  const appSource = readUiSource();
  const styles = readText('src', 'styles.css');
  const viteEnv = readText('src', 'vite-env.d.ts');

  assert.equal(packageJson.dependencies['electron-updater'], '^6.8.3');
  assert.equal(packageJson.build.publish, undefined);
  assert.equal(packageJson.scripts['publish:update'], 'node scripts/publish-update-to-server.cjs');
  assert.match(packageJson.scripts['package:all'], /write-update-source\.cjs/);
  assert.ok(!packageJson.scripts['server:install']);
  assert.ok(!packageJson.scripts['server:start']);
  assert.match(mainProcess, /const \{ autoUpdater \} = require\('electron-updater'\);/);
  assert.match(mainProcess, /readPackagedUpdateUrl/);
  assert.match(mainProcess, /app-update-source/);
  assert.match(mainProcess, /未配置更新地址/);
  assert.match(mainProcess, /UPDATE_BASE_URL/);
  assert.doesNotMatch(mainProcess, /SUPABASE_UPDATE_BASE_URL/);
  assert.doesNotMatch(mainProcess, /sslip\.io/);
  assert.doesNotMatch(mainProcess, /https:\/\//);
  assert.match(mainProcess, /desktop:update-check/);
  assert.match(mainProcess, /desktop:update-download/);
  assert.match(mainProcess, /desktop:update-install/);
  assert.match(mainProcess, /autoUpdater\.autoDownload = false/);
  assert.match(mainProcess, /startAutomaticUpdateChecks/);
  assert.match(mainProcess, /AUTO_UPDATE_CHECK_INTERVAL_MS/);
  assert.match(mainProcess, /new Notification/);
  assert.match(mainProcess, /toastXml: buildUpdateToastXml/);
  assert.match(mainProcess, /getUpdateUnsupportedMessage/);
  assert.match(mainProcess, /autoUpdater\.setFeedURL/);
  assert.match(mainProcess, /url: UPDATE_BASE_URL/);
  assert.match(mainProcess, /downloadAvailableUpdate/);
  assert.match(preload, /checkForUpdates/);
  assert.match(preload, /onUpdateStatus/);
  assert.doesNotMatch(viteEnv, /VITE_SUPABASE_UPDATE_BASE_URL/);
  assert.match(viteEnv, /type DesktopUpdateStatus/);
  assert.match(appSource, /checkForUpdates/);
  assert.match(appSource, /downloadUpdate/);
  assert.match(appSource, /installUpdate/);
  assert.match(styles, /\.update-status-card/);
});

test('cloud settings are Supabase-only', () => {
  const appSource = readUiSource();
  const cloudSync = readText('src', 'cloudSync.ts');

  assert.match(appSource, /cloud-settings-title/);
  assert.match(appSource, /cloudDraft\.provider === 'none' \? 'none' : 'enabled'/);
  assert.match(appSource, /value=\{cloudDraft\.provider === 'none' \? 'none' : 'enabled'\}/);
  assert.match(appSource, /<option value="enabled">/);
  assert.match(appSource, /Supabase Auth/);
  assert.match(appSource, /prompt_libraries/);
  assert.match(appSource, /Supabase URL/);
  assert.match(appSource, /publishable \/ anon key/);
  assert.doesNotMatch(appSource, />VPS</);
  assert.doesNotMatch(appSource, /VPS \/ 自建服务/);
  assert.doesNotMatch(appSource, /apiBaseUrl/);
  assert.doesNotMatch(appSource, /StorageCloudProvider/);
  assert.match(cloudSync, /VITE_ADMIN_EMAILS/);
  assert.match(cloudSync, /settings\.adminEmails\.length === 0/);
  assert.match(cloudSync, /export type CloudProvider = 'none' \| 'supabase';/);
  assert.match(cloudSync, /LEGACY_API_AUTH_KEY/);
  assert.match(cloudSync, /clearLegacyApiAuth/);
  assert.doesNotMatch(cloudSync, /apiRequest/);
  assert.doesNotMatch(cloudSync, /\/api\/sync/);
});

test('legacy VPS store import is offline and Supabase-only', () => {
  const importScript = readText('scripts', 'import-vps-store-to-supabase.cjs');

  assert.match(importScript, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(importScript, /auth\.admin\.listUsers/);
  assert.match(importScript, /auth\.admin\.createUser/);
  assert.match(importScript, /prompt_libraries/);
  assert.match(importScript, /password reset/);
  assert.match(importScript, /Old bcrypt password hashes were not imported/);
  assert.doesNotMatch(importScript, /bcryptjs/);
  assert.doesNotMatch(importScript, /passwordHash/);
  assert.doesNotMatch(importScript, /http\.request/);
  assert.doesNotMatch(importScript, /\/api\/sync/);
});

test('public source keeps deployer endpoints out of the repository', () => {
  const files = [
    'package.json',
    '.env.example',
    'README.md',
    'AGENTS.md',
    'PROJECT_CONTEXT.md',
    'WINDOWS_PACKAGE.md',
    ...readdirSync(join(rootDir, 'src'), { recursive: true })
      .filter((name) => /\.(ts|tsx)$/.test(name))
      .map((name) => `src/${name.replaceAll('\\', '/')}`),
    'electron/main.cjs',
    ...readdirSync(join(rootDir, 'electron', 'materials'), { recursive: true })
      .filter((name) => /\.ts$/.test(name))
      .map((name) => `electron/materials/${name.replaceAll('\\', '/')}`),
    'electron/app-update-source.json',
    'scripts/publish-update-to-server.cjs',
    'scripts/write-update-source.cjs',
  ];

  for (const file of files) {
    const text = readText(...file.split('/'));
    assert.doesNotMatch(text, /@qq\.com/, file);
    assert.doesNotMatch(text, /sslip\.io/, file);
    assert.doesNotMatch(text, /\.pem/, file);
    // 浏览器 User-Agent 里的版本号（如 Chrome/130.0.0.0）长得像 IP，不算。
    const unexpectedIps = (text.replace(/Chrome\/[\d.]+/g, '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []).filter((ip) => ip !== '127.0.0.1');
    assert.deepEqual(unexpectedIps, [], file);
  }

  assert.equal(JSON.parse(readText('electron', 'app-update-source.json')).url, '');
});

test('设置页提供软件说明入口', () => {
  const appSource = readUiSource();
  const styles = readText('src', 'styles.css');

  assert.match(appSource, /软件说明/);
  assert.match(appSource, /aria-controls="software-about-panel"/);
  assert.match(appSource, /TypeScript 和 React 负责界面与状态/);
  assert.match(appSource, /顶部菜单栏负责筛选、导入导出、设置和搜索/);
  assert.match(appSource, /左侧是分类树、创建入口和云端状态/);
  assert.match(styles, /\.about-section/);
  assert.match(styles, /\.about-layout-grid/);
});

test('关闭确认弹窗选项不会被压成窄列', () => {
  const styles = readText('src', 'styles.css');
  const closePanelBlock = styles.match(/\.close-request-panel\s*\{[^}]+\}/s)?.[0] ?? '';
  const closeOptionsBlock = styles.match(/\.close-request-options\s*\{[^}]+\}/s)?.[0] ?? '';
  const closeChoiceBlock = styles.match(/\.settings-option\.close-choice\s*\{[^}]+\}/s)?.[0] ?? '';

  assert.match(closePanelBlock, /width:\s*min\(560px,\s*calc\(100vw - 48px\)\);/);
  assert.match(closePanelBlock, /overflow:\s*visible;/);
  assert.match(closeOptionsBlock, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(closeChoiceBlock, /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
});

test('左侧栏只保留系统标题栏品牌，不再渲染重复品牌块', () => {
  const appSource = readUiSource();
  const styles = readText('src', 'styles.css');

  assert.match(appSource, /import \{[^}]*APP_VERSION[^}]*\} from '\.\.?\/appMeta';/);
  assert.doesNotMatch(appSource, /className="brand-row"/);
  assert.doesNotMatch(appSource, /<Sparkles/);
  assert.doesNotMatch(styles, /\.brand-row/);
  assert.doesNotMatch(styles, /\.brand-mark/);
});

test('侧栏新增分类按钮使用应用内弹窗创建分类', () => {
  const appSource = readUiSource();
  const styles = readText('src', 'styles.css');

  assert.match(appSource, /const \[isCategoryCreatorOpen, setIsCategoryCreatorOpen\] = useState\(false\);/);
  assert.match(appSource, /onAddCategory=\{openCategoryCreator\}/);
  assert.match(appSource, /onCreatePrompt=\{isDocumentMode \? \(\) => void addDocuments\(\) : openNewEditor\}/);
  assert.match(appSource, /className="sidebar-primary-actions"/);
  assert.match(appSource, /className="button ghost sidebar-action-button"[\s\S]+?添加分类/);
  assert.match(appSource, /className="button primary sidebar-action-button"[\s\S]+?新建提示词/);
  assert.doesNotMatch(appSource, /className="section-header category-section-header"[\s\S]+?<span>分类<\/span>/);
  assert.match(appSource, /function CategoryCreatorDialog/);
  assert.match(appSource, /aria-labelledby="category-create-title"/);
  assert.doesNotMatch(appSource, /aria-label="新增分类" title="新增分类" onClick=\{onAddCategory\}/);
  assert.doesNotMatch(appSource, /const addCategory = \(\) => \{\s*const name = window\.prompt\('请输入新分类名称'\)/s);
  assert.match(styles, /\.sidebar-primary-actions/);
  assert.match(styles, /\.sidebar-action-button/);
  assert.match(styles, /\.category-editor-panel/);
});

test('顶部菜单栏承载筛选、导入导出、设置和搜索，云端操作放在侧栏底部', () => {
  const appSource = readUiSource();
  const styles = readText('src', 'styles.css');
  const sidebarSource = appSource.match(/function Sidebar[\s\S]+?type CategoryNavItemProps/)?.[0] ?? '';
  const topMenuSource = appSource.match(/function TopMenuBar[\s\S]+?type TopViewMenuItemProps/)?.[0] ?? '';
  const workspaceHeaderSource = appSource.match(/<main className="workspace">[\s\S]+?<input/s)?.[0] ?? '';

  assert.match(appSource, /<TopMenuBar/);
  assert.match(topMenuSource, /className="top-menu-bar"/);
  assert.match(topMenuSource, /文件/);
  assert.match(topMenuSource, /视图/);
  assert.match(topMenuSource, /设置/);
  assert.doesNotMatch(topMenuSource, /帮助/);
  assert.match(topMenuSource, /导入文件/);
  assert.match(topMenuSource, /导出文件/);
  assert.match(topMenuSource, /选择导入格式/);
  assert.match(topMenuSource, /选择导出格式/);
  assert.match(topMenuSource, /label="全部" meta=\{promptCount\}/);
  assert.match(topMenuSource, /label="收藏" meta=\{favoriteCount\}/);
  assert.match(topMenuSource, /label="最近使用" meta=\{recentCount\}/);
  assert.match(topMenuSource, /label="删除记录" meta=\{deletedCount\}/);
  assert.match(topMenuSource, /onClick=\{\(\) => runMenuAction\(onOpenSettings\)\}/);
  assert.doesNotMatch(topMenuSource, /top-cloud-status/);
  assert.doesNotMatch(topMenuSource, /onOpenSoftwareAbout/);
  assert.match(topMenuSource, /placeholder=\{`搜索全部\$\{searchLabel\}`\}/);
  assert.match(topMenuSource, /className="search-scope-chip"/);
  assert.match(topMenuSource, /className="top-menu-drag-region"/);
  assert.match(topMenuSource, /className="top-window-controls-reserve"/);
  assert.match(appSource, /initialAboutOpen=\{settingsAboutInitiallyOpen\}/);
  assert.match(sidebarSource, /className="sidebar-cloud-panel"/);
  assert.match(sidebarSource, /className=\{`sidebar-cloud-status \$\{cloudEmail \? 'is-online' : ''\}`\}/);
  assert.match(sidebarSource, /onClick=\{\(\) => void onManualSync\(\)\}/);
  assert.match(sidebarSource, /onClick=\{onSignOut\}/);
  assert.match(sidebarSource, /disabled=\{!cloudEnabled\} onClick=\{onOpenAuth\}/);
  assert.doesNotMatch(sidebarSource, /category-section-header/);
  assert.doesNotMatch(sidebarSource, /toolsOpen/);
  assert.doesNotMatch(sidebarSource, /sidebar-tools-panel/);
  assert.doesNotMatch(sidebarSource, /utility-menu-toggle/);
  assert.match(workspaceHeaderSource, /\{mode === 'detail' && \(/);
  assert.doesNotMatch(workspaceHeaderSource, /新建提示词/);
  assert.match(styles, /\.top-menu-bar/);
  assert.match(styles, /\.top-dropdown-menu/);
  assert.match(styles, /\.sidebar-cloud-panel/);
  assert.match(styles, /\.sidebar-cloud-status/);
  assert.doesNotMatch(styles, /\.top-cloud-status/);
  assert.match(styles, /\.top-search-box/);
  assert.match(styles, /-webkit-app-region:\s*drag/);
  assert.match(styles, /-webkit-app-region:\s*no-drag/);
  assert.match(styles, /\.top-window-controls-reserve\s*\{[\s\S]+?flex:\s*0 0 142px/);
  assert.doesNotMatch(styles, /\.utility-menu-toggle/);
  assert.doesNotMatch(styles, /\.sidebar-tools-panel/);
});

test('顶部搜索有关键词时保持全局搜索，不受当前分类视图限制', () => {
  const promptUtils = readText('src', 'promptUtils.ts');
  const globalSearchBranch = promptUtils.match(/if \(normalizedQuery\) \{[\s\S]+?return prompts\.filter\(matchesQuery\);[\s\S]+?\}/)?.[0] ?? '';
  const globalSearchIndex = promptUtils.indexOf('if (normalizedQuery)');
  const viewFilterIndex = promptUtils.indexOf('const filtered = prompts');

  assert.match(promptUtils, /const matchesQuery = \(prompt: PromptItem\) =>/);
  assert.match(globalSearchBranch, /return prompts\.filter\(matchesQuery\);/);
  assert.ok(globalSearchIndex !== -1 && viewFilterIndex !== -1 && globalSearchIndex < viewFilterIndex);
});

test('新增和导入的子文件追加到所属主文件夹末尾', () => {
  const appSource = readUiSource();

  assert.match(appSource, /setPrompts\(\(items\) => appendPromptsToCategoryEnd\(items, \[newPrompt\]\)\);/);
  assert.match(appSource, /setPrompts\(\(items\) => appendPromptsToCategoryEnd\(items, normalized\)\);/);
  assert.doesNotMatch(appSource, /setPrompts\(\(items\) => dedupePrompts\(\[newPrompt, \.\.\.items\]\)\);/);
  assert.doesNotMatch(appSource, /setPrompts\(\(items\) => dedupePrompts\(\[\.\.\.normalized, \.\.\.items\]\)\);/);
});

test('左侧主文件夹和子文件点击不触发重命名', () => {
  const appSource = readUiSource();
  const categoryItemSource = appSource.match(/function CategoryNavItem[\s\S]+?type PromptTreeItemProps/)?.[0] ?? '';
  const promptTreeItemSource = readText('src', 'components', 'Sidebar.tsx').match(/function PromptTreeItem[\s\S]+$/)?.[0] ?? '';

  assert.doesNotMatch(categoryItemSource, /onDoubleClick/);
  assert.doesNotMatch(promptTreeItemSource, /onDoubleClick/);
  assert.match(categoryItemSource, /className="row-action-menu-item"[\s\S]+?setIsEditing\(true\);[\s\S]+?重命名/);
  assert.match(promptTreeItemSource, /className="row-action-menu-item"[\s\S]+?startRename\(\);[\s\S]+?重命名/);
});

test('提示词顶部动作区提供直接复制提示词按钮', () => {
  const appSource = readUiSource();
  const styles = readText('src', 'styles.css');
  const fullCardSource = appSource.match(/function FullPromptCard[\s\S]+?type PromptDetailProps/)?.[0] ?? '';

  assert.match(fullCardSource, /className="button ghost compact top-edit-button"[\s\S]+?onClick=\{startContentEdit\}[\s\S]+?编辑/);
  assert.match(appSource, /className="button primary compact top-copy-button"[\s\S]+?onCopy\(prompt\.id, prompt\.content\)[\s\S]+?复制提示词/);
  assert.match(appSource, /className="button primary"[\s\S]+?onCopy\(prompt\.id, filledContent\)[\s\S]+?复制提示词/);
  assert.doesNotMatch(fullCardSource, /title="编辑"/);
  assert.doesNotMatch(fullCardSource, /full-copy-bar/);
  assert.match(styles, /\.top-edit-button,\s*\n\.top-copy-button/);
  assert.match(styles, /\.top-copy-button\s*\{/);
  assert.match(styles, /\.preview-actions \.icon-button\s*\{/);
  assert.doesNotMatch(styles, /\.full-copy-bar/);
});

test('分类列表按内容高度紧凑排列', () => {
  const styles = readText('src', 'styles.css');
  const categoriesBlock = styles.match(/\.categories\s*\{[^}]+\}/s)?.[0] ?? '';
  const sidebarBlock = styles.match(/\.sidebar\s*\{[^}]+\}/s)?.[0] ?? '';

  assert.match(categoriesBlock, /align-content:\s*start;/);
  assert.match(sidebarBlock, /gap:\s*10px;/);
  assert.match(sidebarBlock, /padding:\s*14px 16px;/);
});

test('桌面、托盘、悬浮窗图标资源使用新的 PNG 图案', () => {
  const iconPng = readBytes('assets', 'icon.png');
  const iconIco = readBytes('assets', 'icon.ico');
  const floatingHtml = readText('electron', 'floating.html');
  const packageJson = JSON.parse(readText('package.json'));

  assert.deepEqual([...iconPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(iconPng.readUInt32BE(16), 906);
  assert.equal(iconPng.readUInt32BE(20), 976);
  assert.equal(iconIco.readUInt16LE(0), 0);
  assert.equal(iconIco.readUInt16LE(2), 1);
  assert.ok(iconIco.readUInt16LE(4) >= 6);
  assert.match(floatingHtml, /<img src="\.\.\/assets\/icon\.png" alt="" \/>/);
  assert.match(floatingHtml, /border:\s*0;/);
  assert.match(floatingHtml, /background:\s*transparent;/);
  assert.match(floatingHtml, /box-shadow:\s*none;/);
  assert.equal(packageJson.build.win.icon, 'assets/icon.ico');
});
