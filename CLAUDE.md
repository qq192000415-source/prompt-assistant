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
- 界面布局（1.8.0 起）：顶部栏 `TopMenuBar` 是主导航，「提示词 | 文档 | 素材 | 画布」四个标签（复用 `LibrarySwitch`），右边是云同步状态、外观主题菜单、设置。外观主题四套（`src/lib/theme.ts`：浅色、深色、米白、暖夜），只换 `styles.css` 里 `html[data-theme]` 的颜色令牌，深色的两套同时加 `.dark`；组件里不要写死颜色。侧栏的全部/收藏/最近使用/删除记录是一行四个图标加数字。文档库（有文档时）不走 `PromptList`，用 `DocumentBrowser` 文件夹视图：中间文件列表（类型色块、名称和配套指令、大小、添加时间、复制按钮，↑↓ 选、Enter 复制文件，本机已有的整行可拖出），右边是 `DocumentView` 的 `variant="pane"`；分类、排序、筛选的纯逻辑在 `src/documentBrowser.ts`，排序记在 `loadDocumentSort`。提示词库仍是整条展开的卡片流。提示词和文档的搜索、四个视图、导入导出在 `Sidebar` 里。设置是独立页面 `SettingsPage`（`App.tsx` 的 `settingsSection` 不为 null 时替换内容区），分通用、云同步、素材库（NAS）、AI 助手、网络、关于与更新；素材库那三类用 `useMaterialSettings`，不读素材库。离开设置页时素材库视图会重新挂载，按新设置重读。
- `tests/app-ui-assets.test.mjs` 等老测试对界面源码（`App.tsx` 加 `src/components/*.tsx`）做正则匹配，改文案或 JSX 结构时可能要同步改这些正则。

**云同步（Supabase）。**
- 每个用户在 `prompt_libraries` 里只有一行，用 jsonb 存整份快照。
- `saveCloudSnapshot` 按 `updated_at` 做乐观锁，冲突时抛 `CloudConflictError`，先合并云端再写回。窗口获得焦点时也会检查一次云端。
- 什么时候同步由 `src/useCloudSync.ts` 决定：登录后合并、改动后 900ms 防抖保存、冲突合并、焦点拉取、文档文件补传。`cloudSync.ts` 只管请求 Supabase。
- 防抖保存的触发依赖故意不含 `syncRecords`。每次保存成功都会追加一条同步记录，如果算进依赖，就会无限保存。
- 合并规则在 `mergeCloudSnapshot`：同 id 以较新的 `updatedAt` 为准；删除记录比条目新就不复活；删除记录两边取并集（1.8.4 起，以前谁新整份用谁的，并发删除会互相撤销）；恢复、移除、清空删除记录只给记录打 `hidden`，不真删，否则另一台设备的副本会把记录和提示词带回来；提示词和文档的分类各自过滤。
- 文档分类存在 `export_settings.documentLibrary` 里，没有给表加列，避免没执行 SQL 的部署同步失败。

**文档文件。**
- 本机存储由主进程 `electron/attachmentStore.cjs` 负责，路径是 `<userData>/attachments/<sha256>`，单文件上限 50MB。
- 打开、复制、拖出时，先在临时目录生成一份原文件名的副本：打开用的副本只读，发送用的可写。
- 云端存在 Supabase Storage 私有 bucket `prompt-attachments`，路径 `<uid>/<sha256>`，RLS 策略在 `supabase-schema.sql` 末尾。上传在添加文档后和登录合并后进行，下载在打开时按需进行。
- "复制文件"在主进程里通过 PowerShell `Set-Clipboard` 把文件放进剪贴板。剪贴板同时放文件和文字时，Chromium 系软件只拿得到文件，文字会丢，所以"指令+文件"对非文本格式分两步复制。

**素材库（NAS）。**
- 第三个库，和提示词、文档的数据完全分开。素材和索引只存在用户 NAS 的一个专用文件夹里（WebDAV），本机只存加密后的连接设置 `<userData>/materials-nas.json`。部分代码移植自 SuYan（MIT），见 `THIRD_PARTY_NOTICES.md`。
- 按账号分开（1.9.6）：专用文件夹下每个云同步账号一个子文件夹，用登录邮箱（小写）命名，下面的布局都在这个子文件夹里。主进程 `config.ts` 的 `loadConfig` 统一拼上当前账号（界面登录、切换、退出时调 `materials:set-account`），没登录就报错，界面显示「请先登录」；画布任务记下提交时的账号，中途切换也存回原处，队列只给界面看当前账号的任务。管理员账号（`VITE_ADMIN_EMAILS`）第一次打开时，`accountFolder.ts` 用 WebDAV MOVE 把根下的旧数据整体搬进自己的文件夹（账号里已有 `library.json` 就不搬）。所有账号共用一个 NAS 用户，所以这只是软件里互相看不到，不是 NAS 权限隔离。
- NAS 授权（1.9.7）：Supabase 表 `nas_grants`（一个邮箱一行：地址、用户名、密码）和 `app_admins`（管理员名单，手动 insert，仓库里不写真实邮箱），SQL 在 `supabase-schema.sql` 末尾；只有 `is_app_admin()` 能增删改，用户只读得到自己那一行。请求在 `cloudSync.ts` 的 `loadOwnNasGrant` 等。登录后 App 读自己那一行交给主进程 `materials:apply-grant`（`config.ts` 的 `applyGrant`）：本机没填过或之前就是授权来的才连上，存成 `source: 'grant'`；没有那一行就删掉授权来的连接；自己填的（`manual`）一律不动。管理员自己那一行存成 `manual`。授权来的连接不给看密码（`revealConfig` 报错），换成自己的 NAS 必须重新填密码。管理员保存连接时，自己那一行和已授权的账号一起换成新连接。设置页地址、用户名、密码默认遮住，点眼睛看明文。授权管理（1.9.8，`NasGrantsPanel.tsx`）列出所有注册账号和是否已授权：账号名单来自只给管理员的函数 `list_app_users()`（security definer 读 `auth.users`，并上已授权但没注册的邮箱），备注和标签存 `app_user_notes`（只有管理员能读写，收回授权后还在）。
- NAS 上的布局：`library.json`（全部条目）、`media/<sha256><ext>`（原文件）、`thumbs/<sha256>.jpg`（图片缩略图，主进程用 nativeImage 生成）。
- 主进程代码是 TS，写在 `electron/materials/`，由 `vite.electron.config.ts` 打成被 Git 忽略的 `electron/materials.cjs`，`main.cjs` 直接 require。纯逻辑（归一、增删改、同组分组、筛选）在 `src/materials/library.ts`，主进程和界面共用。
- fnOS 的 WebDAV 不认 `If-Match`，所以写 `library.json` 一律走 `libraryStore.ts` 的 `mutateLibrary`：加锁（30 秒自动过期）→ 读最新的 → 改 → 带锁令牌写回 → 解锁。别处不要直接 PUT `library.json`。所有 NAS 请求都走 `webdav.ts` 的 `dav()`，有超时（1.9.2）：等响应最多 60 秒，上传按最慢 50KB/s 加时间；`readText`、`readBytes` 连读内容一起算（`includeBody`）；`downloadToFile` 和 `nas-media://` 只限等响应，内容多长都行。以前没有超时，NAS 卡住时画布存历史的槽位会一直占着队列。
- 渲染进程通过 `nas-media://media/...` 和 `nas-media://thumbs/...` 显示媒体，主进程带上账户去 NAS 取，透传 Range（视频能拖进度条），并返回 `Cache-Control: no-store`。
- 批量任务（`batch.ts` 压缩、`export.ts` 导出）同一时间只跑一个（`tasks.ts` 的 `exclusive`），可取消，进度通过 `materials:progress` 事件推给界面。压缩是先下载、本机处理、把新文件传回 NAS，再用 `replaceMedia` 加锁换记录：只换「还指向旧文件」的条目，没人再用的旧文件随后删掉。
- 视频压缩用的 FFmpeg 不进安装包：第一次用时从 `UPDATE_BASE_URL/components/` 下载到 `<userData>/components/`，校验 `ffmpeg.ts` 里写死的大小和 SHA256。换 FFmpeg 版本时运行 `node scripts/publish-ffmpeg-component.cjs <解压目录>` 上传，再把它打印的值写回 `FFMPEG_COMPONENT`。放子目录是因为 `publish-update-to-server.cjs` 发版时会删掉更新目录根下的旧 `.exe`。
- 导入入口：本机文件和 PNG 元数据（`uploads.ts`）；剪贴板截图、分享链接、提示词文字（`linkImport.ts`）；Word 图文（`wordImport.ts`）；分享包（`sharePackage.ts`，和素言格式互通）。所有导入最后都走 `commitImport` 加锁写入，按 sha256 去重。
- `electron/materials/suyan/` 是原样移植的 SuYan 文件，只改导入路径，不要在里面写我们自己的逻辑。要改行为就在外面的适配文件里改，比如即梦视频的 Referer 就补在 `linkImport.ts`。这样以后跟进 SuYan 的站点适配时可以直接对比上游。例外：1.9.3 起画布比例多了 4:5、5:4、9:21（对齐 iLab），改在 `src/materials/suyan/canvasTypes.ts`、`canvasAiTypes.ts` 的比例类型和 `canvasGeneration.ts` 的比例列表、尺寸表里（都标了「提示词助手改动」），在外面包一层要重写 SuYan 的归一和尺寸函数；`remoteAiClient.ts` 的 `resolveAgnesImageRequestSize` 遇到 Agnes 表里没有的比例就按像素请求。另有三处都在 `suyan/remoteAiClient.ts`，跟进上游时记得保留：`generationRequestTimeoutMs`（45 秒改成 120 秒，常量没导出，外面改不了）；`imageGenerationModelPattern` 里的 `emi` 改成 `\bemi\b`（原写法会命中 gemini，把所有 Gemini 模型当成生图模型，查询模型时被过滤掉；上游 5162899 仍未修）；`buildImageEditRequestForm` 末尾按 `payload.maskDataUrl` 加 `mask` 字段（1.9.0 局部重绘，上游没有）。SuYan 用到的 `sharp` 没装，`suyan/shim.ts` 里的 `getSharp` 是替身：尺寸和透明通道读文件头，像素统计和转 JPEG 用 nativeImage（Node 测试里没有 nativeImage，按不透明处理、转 JPEG 失败时 SuYan 会退回原图）。
- AI 助手（`ai.ts`、`aiSettings.ts`）：图像反推、提示词优化、翻译、分类打标签，以及批量反推、批量分类。请求和提示词全用 `suyan/remoteAiClient.ts`、`suyan/ollamaAiClient.ts`；文本模型和视觉模型两个位置，各自可选 OpenAI 兼容接口或 Ollama，设置存在 `<userData>/materials-ai.json`，Key 用 safeStorage 加密，不上 NAS。看图时把 NAS 上的图下载到临时文件交给 SuYan（它按文件路径读图），用完删掉；视频和 SuYan 不认的格式用缩略图。Ollama 的分类请求在 `ai.ts` 里自己发：SuYan 没设 `num_ctx`，Ollama 默认 4096 装不下带分类目录的提示词。分类只接受候选列表里的名称（库里已有分类＋SuYan 摄影分类体系，别名换成标准名），主分类写进分类，其余并入标签。详情页的 AI 结果只填进草稿，点保存才写入。
- 创作画布（`canvas.ts` 主进程、`src/materials/canvasStore.ts` 状态、`src/components/materials/MaterialCanvas.tsx` 界面）：顶部主导航的第四个标签「画布」（库模式 `canvas`，和 `materials` 共用 `MaterialLibraryView`）。生图和 Agnes 生视频全用 SuYan 的 `generateImagesWithRemoteApi` / `generateVideosWithRemoteApi`，参数逻辑用 `src/materials/suyan/canvasGeneration.ts`。生图模型是 AI 设置里的第三个位置（只能是 OpenAI 兼容接口；测连接只查模型列表，不发会扣费的请求）。1.7.0 起有任务队列和生成历史：`canvasQueue.ts`（纯逻辑）把一次提交拆成每张图一个槽位、各自 n=1 请求，按 AI 设置里的并发上限（1–4，默认 2）跑，临时失败按重试次数（0–5，默认 2）自动重试，400/401/403 这类不重试；取消时释放位置、丢掉迟到的结果，但已发出的请求停不下来（SuYan 的生图函数不收取消信号）。队列在主进程（`canvasService.ts` 接线），关软件时还在排队的会丢。每张生成好的图由 `canvasHistory.ts` 存进 NAS 的 `canvas-history/`（`history.json` + `media/` + `thumbs/`，写入同样走 `mutateJsonFile` 加锁），失败的槽位也记原因；界面右侧「生成记录」= 队列任务 + 历史任务。点「存入素材库」才进素材库：从详情页「发到画布」带来的提示词没改时，新图沿用来源组的标题、分类、标签，归进同一组，否则归到「画布生成」。草稿参数记在 localStorage，参考图和来源组不记。画布是三栏（1.8.5）：生成参数（可收起成窄边）| 生成记录 | 详情栏（左边缘可拖宽 300–720px）；收起、宽度、排序、看法都记在 localStorage（`localState.ts` 的 `loadCanvas*`）。生成记录有「列表 / 网格」两种看法（存的值沿用 1.8.3 的 `tasks` / `wall`）和「最新优先 / 最早优先」排序（`visibleTasks` 按 `createdAt` 合并排序队列和历史）；点哪条都在详情栏显示大图、同任务其他图、参数（选的尺寸和实际尺寸）、完整提示词和全部操作（复用、存入、另存为、重试、取消、删除），点大图进全屏查看。缩略图一律按原图比例完整显示（`object-fit: contain`），比例先用历史里记的宽高。图片框都要写死 `grid-template: minmax(0, 1fr) / minmax(0, 1fr)`，详情栏滚动区要 `grid-auto-rows: max-content`，否则竖图会被撑高裁掉或被压扁。图正在存进历史时点取消不作用于这张。1.8.6：画布页没有页面标题栏；生成中的槽位按选的比例画骨架占位，列表只显示「生成中 0:23」，计时、尝试次数、不定进度条和失败原因只在详情栏；队列槽位有 `startedAt`。生成历史任务有 `references`（提交时把参考图按 sha256 存进 `canvas-history/media`，删任务时参考图和生成的图一起算「还在用」），详情栏「全量恢复」= 提示词 + 参数（`canvasStore.ts` 的 `restoreDraftParams` 反推尺寸）+ 当时的参考图，「仅回填参考图」把生成的图加成参考图；图片走 `materials:canvas-history-image`。参考图能拖动或方向键排序、一键清空。1.9.0：点参考图缩略图全图预览（`ReferenceEditor.tsx` 的 `ReferencePreview`，打开时焦点移进弹窗，否则左右键会同时给参考图换顺序）；右下角铅笔在中间「生成记录」区域打开 `ReferenceEditor`（不弹窗），三种模式：裁剪（自由或按比例）、透视裁剪（四角 + 透视网格，单应矩阵和双线性重采样在纯逻辑 `src/materials/imageEdit.ts`）、局部重绘（照 ComfyUI Draw Mask On Image：涂的地方以实色绿 0,255,0 画进提交的图，另存遮罩 PNG，涂过处透明；涂满 = 整图重绘）。编辑结果用 `canvas.replaceReference` 按对象替换，输出格式跟原图。参考图类型在 `canvasStore.ts` 扩成 `CanvasReference`（多 `sourceDataUrl` 原图、`maskDataUrl` 遮罩），不改 SuYan 的类型；带遮罩的只能是第 1 张、只能一张（OpenAI 的 mask 只作用于第一张图），提交时 payload 多 `maskDataUrl`；Grok、Agnes 走 JSON 不发 mask，只靠绿色标记。生成历史只存带标记的图，全量恢复不带遮罩。改了 `electron/materials/` 或 `suyan/` 后开发版要先 `npm.cmd run build:electron` 再重启 Electron，主进程跑的是打包好的 `materials.cjs`。画布模板和提示词库分开（1.9.5）：存在 NAS 的 `canvas-templates.json`（`electron/materials/canvasTemplates.ts`，写入走 `mutateJsonFile` 加锁，IPC 是 `materials:canvas-template*`），界面是 `CanvasTemplatePanel.tsx` 的右侧宽侧栏（按分类分组的卡片、详情里复制/插入/替换、新建编辑删除），插入和替换记使用次数，次数最多的 4 条显示在提示词框下面。提示词库原有的「画布模板」分类没有迁移。模型下拉用 `materials:ai-set-image-model` 只改生图模型名（整份 `aiSaveSettings` 会把没传的规则和并发重置掉）。选了固定尺寸时 `canvas.ts` 的 `aspectRatioRule` 把比例写进生成规则（有的网关不认 size 参数，只按提示词定横竖。2026-10-20 直连主人的 cliproxy 实测 `gpt-image-2.5-sunburst`：size 都传 1568x672，只传 size 的请求（iLab CONJURE 的写法）返回 1341×1173，带这条规则的返回 1915×821，即 21:9。所以比例靠这条规则，不要删；也不要拿调试版模拟接口返回的 1×1 图当成网关问题），出图后 `sizeMismatchWarning` 比对横竖和宽高比：横竖反了，或宽高比偏差超过 8%（1.9.4 起，以前只比横竖），就在这张图上提示。网关按自己的档位出图，像素数和选的不一样是正常的。2026-10-20 真实网关每个比例出 3 张：33 张里 32 张偏差不超过 0.2%，只有一张 9:16 偏了 18%。
- 抓取分享链接走独立的 Electron 会话（`linkSession.ts`），代理设置（`proxy.ts`）只作用于它，不影响 Supabase、更新检查和 NAS。
- 测试：`tests/materials-library.test.mjs`（纯逻辑），`tests/materials-import.test.mjs`（分享包读写、Word），`tests/suyan-*.test.ts`（SuYan 原有的解析器测试），`tests/materials-nas.test.mjs`（用本地模拟的 WebDAV 测加锁读改写、导出），`tests/materials-ffmpeg.test.mjs`（FFmpeg 参数、进度解析、下载校验），`tests/materials-ai.test.mjs`（用本地模拟的 OpenAI 接口、Ollama 和 WebDAV 测 AI 四项功能和批量任务），`tests/materials-canvas.test.mjs`（模拟生图接口和 Agnes 测文生图、图生图、视频、结果解码、来源组继承、sharp 替身、画布状态）。`batch.ts`、`index.ts`、`config.ts`、`aiSettings.ts` 依赖 Electron，不能在 Node 里直接加载，其余模块都可以。

**数据目录。** `productName` 带版本号，Electron 默认会每个版本换一个 userData 目录。`electron/main.cjs` 启动时固定为 `%APPDATA%\prompt-assistant`，首次启动由 `electron/userDataMigration.cjs` 从最近使用的旧目录 `提示词助手X.Y.Z` 拷贝数据。

**配置。** Supabase URL、anon key、管理员邮箱来自 `.env` 的 `VITE_*`，构建时写进前端产物。更新源 `UPDATE_BASE_URL` 在打包时由 `scripts/write-update-source.cjs` 写入被 Git 忽略的 `electron/app-update-source.local.json`。仓库里不放任何真实地址。
