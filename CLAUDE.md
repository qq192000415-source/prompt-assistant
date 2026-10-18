# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

开工前先读 `AGENTS.md`（硬性规则）和 `PROJECT_CONTEXT.md`（决策、进度、Worklog）。进度变化时要更新 `PROJECT_CONTEXT.md` 的 Worklog。`AGENTS.md` 里说的 `apply_patch` 是 Codex 的工具，在 Claude Code 里用 Edit 代替。

## 常用命令

Windows 环境，npm 脚本里用的是 `set X=...&&` 这种 cmd 语法。在 PowerShell 或 Git Bash 里用 `npm.cmd`。

```bash
npm.cmd test                                  # node --test tests/*.test.mjs tests/*.test.ts（.ts 是从 SuYan 原样搬来的 vitest 测试）
node --test tests/library-logic.test.mjs      # 跑单个测试文件
node --test --test-name-pattern="云端合并" tests/library-logic.test.mjs   # 跑单个用例
npx.cmd tsc -b                                # 类型检查，没有 lint
node --check electron/main.cjs                # .cjs 语法检查（electron/、scripts/ 下每个都要查）
npm.cmd run dev                               # Vite，127.0.0.1:5173
npm.cmd run build:electron                    # 把 electron/materials/*.ts 打成 electron/materials.cjs（build、desktop:dev 会自动先跑）
npm.cmd run desktop:dev                       # Electron 连 5174 端口，dev 要用 --port 5174 启动
npm.cmd run release:publish                   # 打三类包 + 上传更新源 + 公网校验（内部会 build）
```

开发版测桌面功能时，用 `PROMPT_ASSISTANT_USER_DATA=<临时目录>` 启动 Electron，避免写进用户真实数据。加 `--remote-debugging-port=9333` 后，可以用 CDP 驱动渲染进程做实测。

## 发版流程

改了会被打包的代码（`src/`、`electron/`、`index.html`、`package.json`）就要发新版：

1. 版本号改 8 处：`package.json` 的 version、productName、build.productName、artifactName、portable.artifactName；`package-lock.json` 第 3、9 行；`index.html` 的 title。`tests/app-ui-assets.test.mjs` 会校验这些一致。`nsis.shortcutName` 固定为 `提示词助手`，不带版本号：带版本号时每次升级换一个快捷方式名，旧的失效快捷方式会让任务栏图标变白。
2. 跑 `npm.cmd test`、`npx.cmd tsc -b`，以及所有 `.cjs` 的 `node --check`，然后 `npm.cmd run release:publish`。
3. 在发布提交上打 annotated tag `stable-提示词助手X.Y.Z`。tag 只留本地。
4. 同步公开仓库：本地 `master` 有含旧服务器信息的完整历史，**绝不能直接推**。流程是 `git checkout public-source` → `git read-tree -u --reset master` → 扫描 IP、邮箱、域名、密钥 → 提交 → `git push origin public-source:main` → 切回 `master`。不要对 origin 用 `git fetch --prune-tags`，远端没有 tag，会把本地 stable tag 全删掉。

## 架构要点

**一个条目类型，两个库。** 提示词和文档都是 `PromptItem`（`src/types.ts`），文档带 `kind: 'document'` 和 `file`（name、size、sha256）。`App.tsx` 用 `allItems` 存全部条目，按 `libraryMode` 派生出 `prompts`，并提供包装过的 `setPrompts`，只修改当前库的子集，另一个库原样保留。`storedCategories` / `setStoredCategories` 同样指向当前库的那一套分类。所以现有的增删改、排序、重命名、删除恢复逻辑对两个库通用。需要同时作用于两个库的地方（持久化、云快照、导出、恢复删除记录）直接用 `allItems` 和 `prompt*` / `document*` 状态。

**纯逻辑和 UI 分开。**
- `src/librarySync.ts`：合并、去重、记录清理、分类派生，以及登录/手动同步时"合并还是只拉云端"的决策（`reconcileWithCloud`）。
- `src/promptStorage.ts`：条目和分类的本机读写，JSON、TXT、CSV 的导入解析和导出序列化。
- `src/localState.ts`：其余本机状态（删除记录、同步记录、导出设置、侧栏宽度、库模式、记住的登录）。
- `src/desktopSettings.ts`：桌面设置的归一。
- 这些文件只用 `import type` 或带 `.ts` 后缀的导入，Node 24 能直接加载源码做行为测试（`tests/library-logic.test.mjs`、`tests/local-state.test.mjs`）。测试前要设 `globalThis.window ??= globalThis`，`local-state` 测试还要自备一个 localStorage。`tsconfig.app.json` 开了 `allowImportingTsExtensions`。
- `App.tsx` 只放状态和处理函数，界面组件在 `src/components/`（`ui/` 是 shadcn 基础件）。
- `tests/app-ui-assets.test.mjs` 等老测试对界面源码（`App.tsx` 加 `src/components/*.tsx`）做正则匹配，改文案或 JSX 结构时可能要同步改这些正则。

**云同步（Supabase）。**
- 每个用户在 `prompt_libraries` 里只有一行，用 jsonb 存整份快照。
- `saveCloudSnapshot` 按 `updated_at` 做乐观锁，冲突时抛 `CloudConflictError`，先合并云端再写回。窗口获得焦点时也会检查一次云端。
- 什么时候同步由 `src/useCloudSync.ts` 决定：登录后合并、改动后 900ms 防抖保存、冲突合并、焦点拉取、文档文件补传。`cloudSync.ts` 只管请求 Supabase。
- 防抖保存的触发依赖故意不含 `syncRecords`。每次保存成功都会追加一条同步记录，如果算进依赖，就会无限保存。
- 合并规则在 `mergeCloudSnapshot`：同 id 以较新的 `updatedAt` 为准；删除记录比条目新就不复活；提示词和文档的分类各自过滤。
- 文档分类存在 `export_settings.documentLibrary` 里，没有给表加列，避免没执行 SQL 的部署同步失败。

**文档文件。**
- 本机存储由主进程 `electron/attachmentStore.cjs` 负责，路径是 `<userData>/attachments/<sha256>`，单文件上限 50MB。
- 打开、复制、拖出时，先在临时目录生成一份原文件名的副本：打开用的副本只读，发送用的可写。
- 云端存在 Supabase Storage 私有 bucket `prompt-attachments`，路径 `<uid>/<sha256>`，RLS 策略在 `supabase-schema.sql` 末尾。上传在添加文档后和登录合并后进行，下载在打开时按需进行。
- "复制文件"在主进程里通过 PowerShell `Set-Clipboard` 把文件放进剪贴板。剪贴板同时放文件和文字时，Chromium 系软件只拿得到文件，文字会丢，所以"指令+文件"对非文本格式分两步复制。

**素材库（NAS）。**
- 第三个库，和提示词、文档的数据完全分开。素材和索引只存在用户 NAS 的一个专用文件夹里（WebDAV），本机只存加密后的连接设置 `<userData>/materials-nas.json`。部分代码移植自 SuYan（MIT），见 `THIRD_PARTY_NOTICES.md`。
- NAS 上的布局：`library.json`（全部条目）、`media/<sha256><ext>`（原文件）、`thumbs/<sha256>.jpg`（图片缩略图，主进程用 nativeImage 生成）。
- 主进程代码是 TS，写在 `electron/materials/`，由 `vite.electron.config.ts` 打成被 Git 忽略的 `electron/materials.cjs`，`main.cjs` 直接 require。纯逻辑（归一、增删改、同组分组、筛选）在 `src/materials/library.ts`，主进程和界面共用。
- fnOS 的 WebDAV 不认 `If-Match`，所以写 `library.json` 一律走 `libraryStore.ts` 的 `mutateLibrary`：加锁（30 秒自动过期）→ 读最新的 → 改 → 带锁令牌写回 → 解锁。别处不要直接 PUT `library.json`。
- 渲染进程通过 `nas-media://media/...` 和 `nas-media://thumbs/...` 显示媒体，主进程带上账户去 NAS 取，透传 Range（视频能拖进度条），并返回 `Cache-Control: no-store`。
- 批量任务（`batch.ts` 压缩、`export.ts` 导出）同一时间只跑一个（`tasks.ts` 的 `exclusive`），可取消，进度通过 `materials:progress` 事件推给界面。压缩是先下载、本机处理、把新文件传回 NAS，再用 `replaceMedia` 加锁换记录：只换「还指向旧文件」的条目，没人再用的旧文件随后删掉。
- 视频压缩用的 FFmpeg 不进安装包：第一次用时从 `UPDATE_BASE_URL/components/` 下载到 `<userData>/components/`，校验 `ffmpeg.ts` 里写死的大小和 SHA256。换 FFmpeg 版本时运行 `node scripts/publish-ffmpeg-component.cjs <解压目录>` 上传，再把它打印的值写回 `FFMPEG_COMPONENT`。放子目录是因为 `publish-update-to-server.cjs` 发版时会删掉更新目录根下的旧 `.exe`。
- 导入入口：本机文件和 PNG 元数据（`uploads.ts`）；剪贴板截图、分享链接、提示词文字（`linkImport.ts`）；Word 图文（`wordImport.ts`）；分享包（`sharePackage.ts`，和素言格式互通）。所有导入最后都走 `commitImport` 加锁写入，按 sha256 去重。
- `electron/materials/suyan/` 是原样移植的 SuYan 文件，只改导入路径，不要在里面写我们自己的逻辑。要改行为就在外面的适配文件里改，比如即梦视频的 Referer 就补在 `linkImport.ts`。这样以后跟进 SuYan 的站点适配时可以直接对比上游。
- 抓取分享链接走独立的 Electron 会话（`linkSession.ts`），代理设置（`proxy.ts`）只作用于它，不影响 Supabase、更新检查和 NAS。
- 测试：`tests/materials-library.test.mjs`（纯逻辑），`tests/materials-import.test.mjs`（分享包读写、Word），`tests/suyan-*.test.ts`（SuYan 原有的解析器测试），`tests/materials-nas.test.mjs`（用本地模拟的 WebDAV 测加锁读改写、导出），`tests/materials-ffmpeg.test.mjs`（FFmpeg 参数、进度解析、下载校验）。`batch.ts`、`index.ts`、`config.ts` 依赖 Electron，不能在 Node 里直接加载，其余模块都可以。

**数据目录。** `productName` 带版本号，Electron 默认会每个版本换一个 userData 目录。`electron/main.cjs` 启动时固定为 `%APPDATA%\prompt-assistant`，首次启动由 `electron/userDataMigration.cjs` 从最近使用的旧目录 `提示词助手X.Y.Z` 拷贝数据。

**配置。** Supabase URL、anon key、管理员邮箱来自 `.env` 的 `VITE_*`，构建时写进前端产物。更新源 `UPDATE_BASE_URL` 在打包时由 `scripts/write-update-source.cjs` 写入被 Git 忽略的 `electron/app-update-source.local.json`。仓库里不放任何真实地址。
