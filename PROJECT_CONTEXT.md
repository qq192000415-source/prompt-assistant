# PROJECT_CONTEXT

Last updated: 2026-10-17

Project root: 仓库根目录

Current source version: `1.3.31`

Current update channel: 部署者自己的 `UPDATE_BASE_URL`

本文件是项目长期上下文。每次处理本项目代码任务前必须先读取本文件。任务进度、重要决策、发布状态、验证结果或待办事项变化时，必须同步更新 Worklog。

## Current State

- 当前主项目目录：仓库根目录
- 当前分支：`master`
- 当前源码版本：`1.3.31`
- 云同步只使用 Supabase Auth + `public.prompt_libraries`，不再使用自建/VPS 同步服务。
- 本机数据目录固定为 `%APPDATA%\prompt-assistant`（1.3.26 起）。旧版本按版本号分目录（`提示词助手X.Y.Z`），首次启动自动从最近使用的旧目录搬数据，旧目录保留。
- 安装版自动更新源由部署者写入本机 `.env` 的 `UPDATE_BASE_URL`。仓库不保存真实服务器地址。
- 本机个人部署参数放在被 Git 忽略的 `LOCAL_DEPLOY.md` 和 `.env`。
- 旧服务器云端数据当前拿不到，因此不从旧服务器拉取；用户登录 Supabase 后，会把本机 localStorage 数据按原同步规则同步到云端。

## Project Summary

本项目是 Windows 桌面端“提示词助手”，用于管理、分类、查看、编辑、复制、导入导出和云同步提示词。

技术栈：

- Frontend: React + TypeScript + Vite
- Desktop: Electron
- Styling: Tailwind CSS 4 + shadcn/ui 设计令牌（`src/styles.css`、`src/components/ui/`）
- Local data: browser localStorage
- Cloud sync: Supabase Auth + `prompt_libraries` table + RLS
- Auto update: `electron-updater` + 部署者自己的 HTTPS generic provider
- Packaging: electron-builder
- Tests: Node.js built-in test runner

## Key Decisions

- 顶部搜索框必须是全局搜索：输入关键词后在全部提示词中匹配标题、正文、主文件夹、子分类和标签，不受当前选中的分类或子分类限制。
- 新建/导入提示词必须按“主文件夹 + 子标题 + 内容”去重。
- 数据变更必须同时考虑 localStorage 和 Supabase 云同步行为。
- 云同步必须双向同步；本地明确删除过的数据不能被云端旧数据重新拉回。
- 普通用户不能查看或修改 Supabase URL、publishable key 或其他云端配置。
- 管理员邮箱来自 `VITE_ADMIN_EMAILS`。未配置时，本机可以直接修改云端设置。
- Supabase 只负责 Auth、RLS、`prompt_libraries` 数据同步和文档库文件（Storage 私有 bucket `prompt-attachments`）；不承担安装包更新文件发布。
- 文档库：文档条目复用 PromptItem（`kind: 'document'` + `file`），合并、删除记录、恢复、排序沿用提示词逻辑。文档分类单独存，云端放在 `export_settings.documentLibrary`，不给表加列，避免没跑 SQL 的部署同步失败。
- 文档的核心场景是发给别人：主按钮是“复制文件”（Windows 剪贴板文件列表），标题可拖出去；.md/.txt 另有“复制内容”。提示词条目不挂附件。
- .md/.txt 文档可以在软件里直接编辑正文（“编辑”按钮或双击正文）。文件按 sha256 存，所以保存时新内容另存一份、条目改指向新 sha256，再补传到云端；旧版本文件不删。原文件是 CRLF 换行的，保存时保持 CRLF。
- 文档可以写一段「配套指令」（存在条目的 `description` 字段，会同步、能搜到），把文件发给 AI 时配合使用，有单独的“复制指令”按钮。
- 指令和文件一起给 AI：.md/.txt 一次复制“指令 + 文件全文”；其他格式分两步，先复制“指令 + 文件路径”（终端 AI 够用），按钮变成“② 复制文件”再复制文件。原因：剪贴板同时放文件和文字时，Chromium 系软件（网页 AI、Claude/ChatGPT 桌面版、Cursor、VS Code）粘贴只拿到文件，文字会丢，2026-10-12 实测确认。
- 搜索在当前库内全局匹配，另一个库也有结果时显示提示，一键切换。
- 公开仓库只放不带历史的快照：本地 `master` 有完整旧历史，不能直接推。同步流程：`git checkout public-source` → `git read-tree -u --reset master` → 扫描 IP/邮箱/域名/密钥 → 提交 → `git push origin public-source:main` → 切回 `master`。
- 安装包更新文件放在部署者自己的 HTTPS 目录，默认远程路径是 `/prompt-assistant-updates/win/`。
- 禁止写入或提交 Supabase secret key、service_role key、服务器密码等秘密信息。
- 修改会被打包的源码或配置后，必须递增可见应用版本和 package 版本，并运行测试、语法检查、完整打包和发布验证。
- 完整打包和发布必须保留三类当前版本产物：安装版、便携版、`release/win-unpacked/` 文件夹版。
- 更新源只保留当前版本安装包、当前 `.blockmap` 和 `latest.yml`，旧安装包和旧 blockmap 要清理。
- 保存稳定版优先使用 Git tag；基于稳定版继续开发优先新建分支，不默认 `reset --hard`。
- 每个发布的版本号都有对应 tag `stable-提示词助手X.Y.Z`，打在该版本的发布提交上。tag 只留在本地，不推到公开仓库（会带出旧历史）。
- 手工编辑文件使用 `apply_patch`；保留用户已有改动，不重置、不回滚无关工作。

## Architecture Notes

### Local First

应用优先保证本地可用。提示词、分类、子分类、删除记录、同步记录、导出设置和云端会话信息主要存储在 localStorage。未登录 Supabase 时，用户也可以完整使用本地管理能力。

### Cloud Sync

同步对象包含 prompts、categories、subcategories、deletedRecords、syncRecords、exportSettings。

Supabase 数据模型：

- Auth 使用邮箱密码登录/注册。
- `public.prompt_libraries.user_id` 对应 `auth.users.id`。
- 每个用户只读写自己的 `prompt_libraries` 行。
- `supabase-schema.sql` 启用并强制 RLS；authenticated 按 `auth.uid() = user_id` 读写自己的行。
- 匿名访问只用于受 RLS 保护的探测，不应看到其他用户数据。

### Auto Update

Electron 主进程通过 `electron-updater` 使用 generic provider。更新地址来自打包时写入的 `electron/app-update-source.local.json`，其内容取自 `.env` 的 `UPDATE_BASE_URL`。仓库里的 `electron/app-update-source.json` 保持空地址。

发布脚本 `scripts/publish-update-to-server.cjs` 上传：

- 当前安装包 exe
- 当前安装包 `.blockmap`
- `release/latest.yml`

上传顺序必须是安装包、blockmap、最后 `latest.yml`。上传后清理同一目录下旧 `.exe` 和旧 `.blockmap`。

## Important Files

- `src/App.tsx`
  - 主应用组件，约 1450 行：管理条目、分类、删除记录、同步记录等状态，以及增删改、导入导出、文档添加的处理函数。不放界面子组件，也不放云同步时机。
- `src/components/`
  - 界面组件：`Sidebar`（分类树和行操作菜单）、`TopMenuBar`、`SettingsPanel`、`Dialogs`（关闭确认、通用确认、登录、新建分类）、`PromptList`、`PromptView`（全文卡片和详情）、`PromptEditor`、`DocumentView`（文档预览和配套指令）、`DeletedRecordsView`。`ui/` 是 shadcn 基础件。
- `src/useCloudSync.ts`
  - 云同步时机：登录后合并、防抖自动保存、冲突合并、焦点拉取、文档文件补传、登录、退出、手动同步。合并规则在 `librarySync.ts`。
- `src/localState.ts`、`src/desktopSettings.ts`
  - 本机状态读写（删除记录、同步记录、导出设置、侧栏宽度、库模式、记住的登录）和桌面设置归一，可在 Node 里测试。
- `electron/attachmentStore.cjs`
  - 文档文件本机存储：按 sha256 存在 `<userData>/attachments`，单文件上限 50MB，校验 sha，生成原文件名的临时副本用于打开（只读）、复制和拖出（可写）。
- `electron/userDataMigration.cjs`
  - 把旧版本按版本号分开的数据目录搬到固定目录。
- `src/librarySync.ts`
  - 纯函数：云端合并（`mergeCloudSnapshot`）、登录/手动同步时决定"合并还是只拉云端"（`reconcileWithCloud`）、写回前打同步记录（`stampSnapshot`）、去重、分类派生、删除记录/同步记录清理、导出设置归一。不碰 localStorage，可直接在 Node 里测试。
- `src/cloudSync.ts`
  - Supabase-only 云同步核心逻辑。
  - `saveCloudSnapshot` 按 `updated_at` 做乐观锁：云端被其他设备改过时抛 `CloudConflictError`，App 先合并再写回。
  - 兼容旧 localStorage 中的 `vps` 配置，自动归一到 Supabase 或未配置，并清理旧 VPS JWT 登录态。
- `supabase-schema.sql`
  - Supabase 建表、授权和 RLS 策略；不包含 Storage bucket 预案。
- `scripts/check-supabase-access.cjs`
  - Supabase 权限验证脚本；支持登录测试账号读取，以及可选 `--write` 原样 upsert 验证。
- `scripts/import-vps-store-to-supabase.cjs`
  - 离线导入预案；以后拿到旧 `store.json` 后，用 service role 匹配/创建 Supabase Auth 用户并 upsert 到 `prompt_libraries`。
  - 不迁移旧 bcrypt 密码哈希，迁移账号走 Supabase 重置密码流程。
- `scripts/publish-update-to-server.cjs`
  - 更新源发布脚本，服务器参数全部来自 `.env`。
  - 使用本机 SSH key 上传当前安装包更新文件并清理旧包。
- `electron/main.cjs`
  - Electron 主进程；接入自动更新检查、下载、重启安装 IPC，更新地址来自打包时写入的 `electron/app-update-source.local.json`。
- `tests/app-ui-assets.test.mjs`
  - 覆盖版本一致性、打包规则、服务器更新发布、Supabase-only 云同步、UI 关键行为和图标资源。
  - 读源码做正则匹配，不执行业务逻辑。
- `tests/library-logic.test.mjs`
  - 行为测试：直接导入 `src/*.ts`（Node 24 原生去类型），覆盖去重、追加顺序、云端合并、删除不复活、同步记录清理、CSV/TXT 导入。
- `WINDOWS_PACKAGE.md`
  - Windows 打包、更新服务器发布和 Supabase 云同步说明。
- `AGENTS.md`
  - AI 自动读取入口和硬性规则。

## Worklog

### Current Progress

当前源码版本为 `1.3.31`。左栏可在「提示词 | 文档」间切换，文档库原样保存文件。界面升级到 shadcn/ui 设计令牌，保留双栏工作流，并支持本机浅色/深色外观。安装包更新源改为本项目自己的子域名，地址只写在本机 `.env`，不和其他项目共用主机名。

- 云同步：Supabase Auth + `prompt_libraries`，地址来自 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`
- 安装包更新：部署者自己的 HTTPS 目录，地址来自 `UPDATE_BASE_URL`

已完成：

- 云同步客户端收敛到 Supabase-only。
- 设置页移除 VPS / 自建服务选项、VPS 云端地址和账号 provider 分配。
- 删除旧 VPS 服务端目录、服务端打包 zip 和旧 SSH 发布脚本。
- 新增旧 `store.json` 离线导入脚本。
- 自动更新源从 Supabase Storage 改为腾讯云服务器 URL。
- 发布脚本改为 SSH 上传到 `/opt/prompt-assistant-updates/win`。
- 版本推进到 `1.3.20`。
- 按方案 B 完成整体 UI 视觉和效率优化：保留双栏阅读流，强化顶部全局搜索范围表达，搜索时将左侧分类选中态降级为位置上下文，并统一浅色工作台设计系统。
- 侧栏主文件夹/子文件操作菜单改为固定浮层，不再打开菜单时破坏分类列表滚动边界或覆盖底部云同步区域。
- 界面升级为 shadcn/ui + Tailwind 设计令牌：中性表面、发丝边框、单一蓝色强调色、浅色/深色外观，以及菜单、弹窗和提示的短过渡。业务逻辑未改。

### Latest Verification

- 2026-10-17：`1.3.31` 新增 .md/.txt 文档在软件里直接编辑。测试 54 项通过（新增“编辑后另存一份”1 项），`npx tsc -b` 和全部 `.cjs` 的 `node --check` 通过。Electron 开发版用临时数据目录实测：点“编辑”出现编辑框，改一行后保存，预览立刻更新，条目的 sha256 和大小换成新文件，搜索用的 content 同步更新，CRLF 换行保留；Esc 能取消。`release:publish` 生成三类产物，公网校验安装包、blockmap、`latest.yml` 通过。没有实测登录状态下新文件补传到云端（没有测试账号），走的是添加文档时同一个 `pushDocumentFiles`。
- 2026-10-15：`1.3.30` 测试 53 项通过，`npx tsc -b` 通过，开 `--noUnusedLocals --noUnusedParameters` 也没有报错，`npm run build` 通过。浏览器开发版实测：给提示词加子分类后，侧栏分类树、分类视图、行操作菜单都正常，控制台没有报错。
- 2026-10-15：`1.3.29` 结构重构。测试 53 项通过（新增 10 项行为测试），`npx tsc -b` 和全部 `.cjs` 的 `node --check` 通过，`npm run build` 通过。故意改坏 CSV 转义、删除记录过期过滤、“只有示例数据时只拉云端”这三处后，对应测试都会失败。浏览器开发版实测：新建提示词、删除主文件夹走确认弹窗、在删除记录里恢复、全局搜索、切到文档库、设置、登录面板、新建分类弹窗都正常，界面截图和改动前一致。Electron 开发版用临时数据目录（`PROMPT_ASSISTANT_USER_DATA`）实测：通过桌面桥写入一个 .md 文档后，文档库能显示 Markdown 预览和文件操作按钮；设置页能读到主进程的桌面设置。没有真实账号，所以没实测云同步登录、自动保存和冲突合并，只用单元测试覆盖了合并决策。
- 2026-10-12：`1.3.28` 测试 43 项通过，`npx tsc -b` 通过。Electron 实测：剪贴板同时放文件和文字时，Chromium 的 paste 事件只有 `Files`，文字丢失，所以放弃这个做法。.md 点“复制指令+内容”后，paste 事件拿到指令 + 分隔线 + 全文。.docx 第一步剪贴板是“指令 + 文件路径”，按钮变成“② 复制文件”，第二步剪贴板是 `需求说明.docx`。
- 2026-10-12：`1.3.27` 测试 43 项通过，`npx tsc -b` 通过。Electron 开发版实测：文档上点“添加配套指令”，写两行后按 Ctrl+S 保存，正常显示、写入 localStorage 的 `description`；复制指令拿到原文；搜索指令里的文字能搜到这个文档。
- 2026-10-12：`1.3.26` 测试 43 项全部通过（新增文件存储 6 项、数据目录迁移 3 项、文档逻辑 3 项），`npx tsc -b` 和全部 `.cjs` 的 `node --check` 都通过。改坏“按条目类型过滤删除记录”后新测试能失败。在 Electron 开发版用独立数据目录（`PROMPT_ASSISTANT_USER_DATA`）实测：文档库显示 3 个文件，.md 排版（标题、列表、表格）、.txt 原样、.docx 显示无法预览的提示；复制文件后 Windows 剪贴板里是 `需求说明.docx`、3000 字节、非只读；复制内容拿到 Markdown 原文；搜索时显示另一个库的匹配提示并能切换；切回提示词库后看不到文档，6 个原有分类不变；删除文档再恢复，回到文档库，分类不串；深色模式正常。真实 `%APPDATA%` 没有被测试写入。旧目录选择在本机预演选中 `提示词助手1.3.24`。未实测：原生选择文件对话框、拖出、打开、另存为、在文件夹中显示、云端文件上传下载。
- 2026-10-12：`1.3.25` 测试 31 项全部通过（含 11 项新增行为测试）；`npx tsc -b` 通过；所有 `electron/`、`scripts/` 下的 `.cjs` 文件 `node --check` 通过。故意删掉合并里的删除过滤后，新测试能失败，说明测试有效。浏览器打开开发版：标题、分类树、16 条提示词正常渲染，控制台只有开发模式下的 favicon 404。`release:publish` 生成了安装版、便携版、`win-unpacked`，上传安装包、blockmap、`latest.yml` 后公网校验通过。乐观锁没有用真实账号验证（没有测试账号）。
- 2026-10-07：界面升级后 `npm.cmd test` 20 项通过，`npx tsc -b` 通过。浏览器核对了桌面浅色/深色、设置、新建提示词、文件菜单、复制提示、390px 窄屏和侧栏抽屉。
- 2026-10-07：`npm.cmd run release:publish` 已在本地生成 `1.3.22` 安装版、便携版、`release/win-unpacked/` 和 blockmap。上传更新源失败：`.env` 中的 SSH 私钥文件不在本机，因此没有发布，也没有校验公网 `latest.yml`。
- 2026-10-07：已在本机当前用户安装 `1.3.22`，程序位于 `%LOCALAPPDATA%\Programs\prompt-library\提示词助手1.3.22.exe`。桌面和开始菜单快捷方式已指向该版本，旧的 `1.3.20` 快捷方式已删除。更新源仍未发布。
- 2026-10-07：用部署者提供的 SSH 私钥上传了 `1.3.22` 安装包、blockmap 和 `latest.yml`，并清掉了该目录里的旧包。服务器本机用更新域名访问这三个文件都是 HTTP 200，大小一致。公网 DNS 不再把更新域名指到这台服务器，所以从本机做公网 HTTPS 校验失败，已安装的 `1.3.22` 还不能从公网拉到这次更新。证书有效期到 2026-10-08。
- 2026-10-07：按每个项目独立子域名，为提示词助手单独加了 DNS 和 Caddy 站点，不再使用已经失效的旧更新主机名，也没有挂到其他项目的站点上。源码版本推进到 `1.3.23`。`npm.cmd test` 20 项通过，`release:publish` 已上传安装包、blockmap 和 `latest.yml`，公网校验三个文件都是 200。本机已安装并打开 `1.3.23`。Cloudflare 令牌没有写入仓库。
- 2026-10-07：修复正文标题栏滚到顶栏下方时透出滚动内容的缝。标题栏改为不透明，并向上补住顶栏与标题栏之间的空隙。版本推进到 `1.3.24`。`npm.cmd test` 20 项通过，`release:publish` 公网校验安装包、blockmap 和 `latest.yml` 均为 200。本机已安装 `1.3.24`。
- 2026-10-07：`node --check` 覆盖 `electron/main.cjs`、`electron/preload.cjs`、`scripts/load-env-file.cjs`、`scripts/write-update-source.cjs`、`scripts/publish-update-to-server.cjs`、`scripts/clean-release.cjs`、`scripts/check-supabase-access.cjs`、`scripts/import-vps-store-to-supabase.cjs`，全部通过。
- 2026-10-07：`npm.cmd test` 通过，20 项测试全绿。公开源码检查确认仓库文件不再包含个人邮箱、更新域名、私钥路径和公网 IP。
- 2026-10-07：（1.3.21 公开源码那一轮）本轮没有打包，也没有执行 `release:publish`。当时更新源停留在 `1.3.20`；之后已被 1.3.23、1.3.24 的发布取代。
- 2026-05-13：`node --check scripts/check-supabase-access.cjs` 通过。
- 2026-05-13：`scripts/check-supabase-access.cjs --write` 使用管理员测试账号验证 Supabase：匿名表探测被权限/RLS 拦截；登录后读取成功；登录后原样 upsert 自己的 `prompt_libraries` 快照成功。
- 2026-05-14：`npm.cmd run release:publish` 曾完成 `1.3.17` 本地打包；Supabase Storage 上传因单文件大小限制失败，因此改用腾讯云服务器作为安装包更新源。
- 2026-05-14：更新服务器的静态路由已配置并 reload。
- 2026-05-14：`node --check electron/main.cjs`、`electron/preload.cjs`、`scripts/clean-release.cjs`、`scripts/publish-update-to-server.cjs`、`scripts/check-supabase-access.cjs`、`scripts/import-vps-store-to-supabase.cjs` 通过。
- 2026-05-14：`npm.cmd test` 通过，17 项测试全绿。
- 2026-05-14：`npm.cmd run build` 通过。
- 2026-05-14：`npm.cmd run release:publish` 已生成并发布 `1.3.18` 三类产物；公网 `latest.yml`、安装包和 blockmap 均返回 200，大小一致。
- 2026-05-28：`node --test tests/sidebar-menu-layout.test.mjs` 通过，覆盖侧栏行操作菜单不破坏分类列表滚动区域。
- 2026-05-28：方案 B UI 优化开发中的 `npm.cmd run build` 通过；后续已完成完整测试、打包和发布验证。
- 2026-05-28：`node --test tests/overall-ui-scheme-b.test.mjs` 通过，覆盖方案 B 的全局搜索范围提示、左侧搜索上下文态和正文阅读流样式。
- 2026-05-28：`npm.cmd test` 通过，19 项测试全绿。
- 2026-05-28：`npm.cmd run build` 通过。
- 2026-05-28：`npm.cmd run release:publish` 成功生成并发布 `1.3.20` 三类产物；公网 `latest.yml`、安装包和 blockmap 校验通过。
- 2026-05-28：`npm.cmd test` 通过，18 项测试全绿。
- 2026-05-28：`npm.cmd run release:publish` 成功生成并发布 `1.3.19` 三类产物；公网 `latest.yml`、安装包和 blockmap 校验通过。

### Task List

| Status | Task | Notes |
| --- | --- | --- |
| Done | 双栏布局和提示词管理 | 分类树、正文展示、编辑、复制、收藏、删除 |
| Done | 导入导出和去重 | 支持 JSON、TXT、CSV；按主文件夹、子标题、内容去重 |
| Done | 删除记录 | 删除后可进入记录并恢复 |
| Done | Electron 桌面壳 | 主窗口、托盘、preload、IPC |
| Done | 自动更新系统 | 安装版支持检查、下载、重启安装 |
| Done | Supabase 表和 RLS | `prompt_libraries` 自有行读写 |
| Done | Supabase-only 云同步迁移 | 移除旧同步服务依赖 |
| Done | 腾讯云服务器更新源迁移 | Caddy 静态目录、SSH 发布脚本、1.3.18 发布验证完成 |
| Done | 公开仓库远端分支整理 | 2026-10-12 已删除远端 `master` 和 tag `提示词助手1.3.24`，远端只剩快照分支 `main`。本地 `master` 已取消上游跟踪，不要直接推到公开仓库 |
| Todo | 文档库实机补测 | 原生选择文件对话框、拖出到微信/桌面、打开、另存为、在文件夹中显示，需要人工点一遍 |
| Todo | 文档云端同步实测 | 需要在 Supabase SQL Editor 执行最新 `supabase-schema.sql` 开启 bucket，再登录测试上传和下载 |
| Todo | 文档编辑信息 | 目前文档只能在侧栏改名，不能改分类或标签；需要时复用编辑弹窗 |
| Todo | 乐观锁实库验证 | 需要测试账号：设置 `SUPABASE_TEST_EMAIL`、`SUPABASE_TEST_PASSWORD` 后运行 `node scripts/check-supabase-access.cjs --write` |
| Done | 自动同步写前不读云端 | `App.tsx` 自动同步直接 upsert 整份快照。多设备同时在线时后写者覆盖云端，另一台改动要等它重启合并才补回。方案：按 `updated_at` 条件更新，冲突时拉取、合并再写 |
| Done | 同步/去重/导入改成可测 | 把 `App.tsx` 顶部纯函数移到独立模块，用真实输入写行为测试 |
| Done | 结构整理第 1–3 步 | 纯函数移出 App、云同步时机移到 `useCloudSync`、子组件拆到 `src/components/`（1.3.29） |
| Todo P2 | 云同步登录实测 | 1.3.29 重构了云同步的触发代码；需要用真实账号登录一次，确认登录合并、改动后自动保存、两台设备互改能合并 |
| Done | 删除无用代码 | 1.3.30：删掉从 1.3.10 起就没被渲染过的子分类重命名/删除界面及其处理函数和样式、`appMeta` 里没人用的两个常量、没被引用的依赖 `@radix-ui/react-dialog` 和 `@radix-ui/react-label` |
| Keep | 遗留代码保留 | `cloudSync.ts` 的 `vps` 设置兼容：老版本本地存了 `provider: vps` 时，靠它映射回 Supabase，删了这些用户会变成“未配置云端”。`scripts/import-vps-store-to-supabase.cjs`：拿到旧 `store.json` 时用来恢复数据，不进安装包 |
| Todo P2 | 去掉明文记住密码 | `prompt-library.cloudRememberedLogin.v1` 存明文密码；Supabase 已持久化会话，只记邮箱即可 |
| Done | 外链协议白名单 | `electron/main.cjs` 的 `openExternal` 只放行 `http:`、`https:` |
| Todo P3 | schema 去掉 anon select 授权 | RLS 已拦截，授权本身无用 |

### Log Entries

- 2026-10-15：`AGENTS.md` 新增「结构约定」，作为长期规则。内容来自用户给的《开发要求》（模块化、核心与外壳分开、配置与代码分开），没有照抄原文，而是写成本项目可检查的具体边界：纯函数放哪、每类外部依赖的唯一出入口、`App.tsx` 和 `src/components/` 的分工、何时单独成文件、删除功能要删干净、什么放 `.env`。只改文档，不需要递增版本和发布；用户要求后已同步公开仓库（`main` 提交 `9c3ff1c`，推送前扫描无命中）。

- 2026-10-15：版本 `1.3.30`，删除无用代码，功能不变。删掉：侧栏 `SubcategoryNavItem`（从 1.3.10 起就没被渲染过），`App.tsx` 里只传给它的 `renameSubcategory`、`deleteSubcategory`、`subcategoryMap`，对应的 `.subcategory-item`、`.subcategory-tree`、`.subcategory-dot` 样式，`appMeta.ts` 的 `APP_NAME`、`APP_VERSION_LABEL`，依赖 `@radix-ui/react-dialog`、`@radix-ui/react-label`。子分类数据本身（存储、同步、搜索、按子分类的视图）都没动。保留 VPS 设置兼容和旧数据导入脚本，原因见 Task List。`release:publish` 生成了三类产物，上传后公网校验通过。打了 tag `stable-提示词助手1.3.30`。公开仓库同步到 `main`（提交 `1e4b16f`），推送前扫描过，没有 IP、邮箱、更新域名、密钥。
- 2026-10-15：版本 `1.3.29`，结构整理，功能和界面不变。`App.tsx` 从 4692 行降到约 1450 行。本机状态读写移到 `src/localState.ts`，桌面设置归一移到 `src/desktopSettings.ts`。分类派生、示例快照判断、同步记录工厂移到 `librarySync.ts`，导出序列化移到 `promptStorage.ts`。云同步时机（登录合并、防抖保存、冲突合并、焦点拉取、文档补传）移到 `src/useCloudSync.ts`，其中的合并决策抽成纯函数 `reconcileWithCloud`、`stampSnapshot`。界面子组件拆到 `src/components/`。源码正则测试改为检查全部界面源码，公开源码扫描覆盖 `src` 下所有 .ts/.tsx。在分支 `refactor/split-app` 上分三步提交后合回 `master`。`release:publish` 生成了安装版、便携版、`win-unpacked`，上传安装包、blockmap、`latest.yml` 后公网校验通过。打了 tag `stable-提示词助手1.3.29`。公开仓库按快照流程同步到 `main`（提交 `02b2e59`），推送前扫描过，没有 IP、邮箱、更新域名、密钥。
- 2026-10-12：版本 `1.3.28`。配套指令区新增“复制指令+内容”（.md/.txt）和“复制指令+文件”（其他格式，两步）。
- 2026-10-12：版本 `1.3.27`。文档新增「配套指令」：文件信息下方可以添加、编辑、复制一段给 AI 的指令。
- 2026-10-12：按快照流程把源码同步到 GitHub `main`（提交 `67d5c60`，内容与本地 1.3.26 一致）。推送前扫描过，没有 IP、邮箱、更新域名、密钥。
- 2026-10-12：版本 `1.3.26`。新增文档库：左栏「提示词 | 文档」切换，各自独立分类；文档原样保存，可复制文件、拖出、复制内容、打开、另存为、在文件夹中显示，.md 用 react-markdown 排版。文件存本机 `attachments` 和 Supabase Storage。修复：数据目录随版本号变化，导致升级后本机提示词和登录状态找不到；现在固定目录并自动迁移。
- 2026-10-12：版本 `1.3.25`。把合并、去重逻辑移到 `src/librarySync.ts`，TXT/CSV 导入解析移到 `src/promptStorage.ts`，新增行为测试。云端写入改为按 `updated_at` 的乐观锁，冲突时先合并再写；窗口重新获得焦点时检查云端是否被其他设备改过，有就合并进来。外链只放行 http/https。清理：旧 vite 日志、5 月的计划文件、`output/` 方案图、`assets/extracted-icon-check.png`、未使用的 `cloudConfig` 导出、两个已合并的旧 codex 分支。`tsconfig.app.json` 开启 `allowImportingTsExtensions`，让 Node 测试能加载 `promptStorage.ts`。
- 2026-10-12：项目交由 Claude Code 负责后续迭代。整理文档：修正过期的“腾讯云”描述、样式技术栈和互相矛盾的发布记录；把代码审查发现的问题写进 Task List。只改文档，未改打包源码，不需要递增版本和发布。工具差异：AGENTS.md 要求用 `apply_patch`，Claude Code 用等价的 Edit 工具做手工编辑。
- 2026-10-07：按 UI 组件库地图把界面升级到 shadcn/ui。基础库是 shadcn/ui，主题令牌统一配色、字号、圆角和阴影，外观选择只存在本机 localStorage。源码版本推进到 `1.3.22`。搜索、分类、编辑、导入导出和云同步逻辑未改。
- 2026-10-07：为公开二次开发去掉仓库内的个人管理员邮箱、更新服务器和 SSH 默认路径。云同步、管理员邮箱和更新地址改由 `.env` 提供。源码版本推进到 `1.3.21`。个人部署参数留在本机 `.env` 和 `LOCAL_DEPLOY.md`。
- 2026-10-07：公开仓库为 `https://github.com/qq192000415-source/prompt-assistant`。推上去的是不含旧提交历史的源码快照，避免旧历史里的服务器信息一并公开。
- 2026-10-07：仓库首页 `README.md` 增加主界面截图 `docs/app-home.jpg`。截图不进入安装包。
- 2026-05-09：修复顶部搜索从全局搜索退化为当前分类/子分类内搜索的问题；源码版本推进到 `1.3.16` 并发布。
- 2026-05-13：处理 Supabase “服务器在线但表权限/RLS 不完全可用”的判断。补充 `supabase-schema.sql`：强制 RLS，并给 anon 增加受 RLS 保护的 select 授权；新增 `scripts/check-supabase-access.cjs`。使用管理员账号验证登录后读取和原样 upsert 成功。
- 2026-05-14：按用户要求开始 Supabase-only 迁移。旧服务器不是用户自己的，后续不再使用；旧服务器云端数据当前拿不到，因此不执行旧服务器数据导入，保留本机 localStorage 登录 Supabase 后同步上云的路径。删除旧服务端资产，版本推进到 `1.3.17`。
- 2026-05-14：完成 Supabase-only 云同步收尾。云同步、设置页、打包文档和测试均改为 Supabase-only；新增旧 `store.json` 离线导入脚本。`release:publish` 生成 1.3.17 三类产物，Supabase Storage 上传因单文件大小限制不可用。
- 2026-05-14：开始把安装版自动更新源迁移到用户自有腾讯云轻量服务器。更新源 URL 固定为 `部署者自己的 UPDATE_BASE_URL`，版本推进到 `1.3.18`。
- 2026-05-14：完成腾讯云服务器更新源迁移。服务器新增 `/opt/prompt-assistant-updates/win`，Caddy 增加 `/prompt-assistant-updates/*` 静态路由；`release:publish` 成功上传 `1.3.18` 安装包、blockmap 和 `latest.yml`，公网校验通过。
- 2026-05-28：修改前已在当前提交创建恢复点 tag `stable-20260528-0102`。使用 `ui-ux-pro-max` 按桌面效率工具方向检查 UI，修复侧栏“...”菜单打开后分类列表溢出并覆盖底部云同步区的问题；版本推进到 `1.3.19`。
- 2026-05-28：按用户选择的方案 B 开始整体 UI 优化，修改前创建恢复点提交 `4a7651b` 和 tag `stable-20260528-0209`；版本推进到 `1.3.20`。
- 2026-05-28：按 `planning-with-files` 方式创建 `task_plan.md`、`findings.md`、`progress.md`，记录当前项目状态、本轮方案 B UI 改动、验证结果、未完成事项和后续可继续方向，方便新对话恢复上下文。
- 2026-08-14：恢复本地 1.3.20 Windows 安装包。`npm.cmd test` 19 项通过，`npm.cmd run build` 通过；安装包、blockmap、`latest.yml` 已重新生成并核对大小/SHA-512。本轮仅恢复本地交付文件，未重新发布腾讯云更新源。
