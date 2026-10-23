# AGENTS

本文件只作为 AI 自动读取入口。详细项目上下文、整体架构、关键决策、进度、重要文件记录和 Worklog 见项目根目录 `PROJECT_CONTEXT.md`。

每次处理本项目代码任务前，必须先读取 `PROJECT_CONTEXT.md`。任务进度变化时，必须同步更新 `PROJECT_CONTEXT.md` 的 Worklog。

## 硬性规则

- 不写入或提交秘密信息：Supabase secret key、service_role key。
- 搜索默认优先用 `rg`；若 `rg` 报“拒绝访问”或已知不可用，直接改用 PowerShell 的 `Get-ChildItem` 和 `Select-String`，不要反复尝试。
- 手工编辑文件用 `apply_patch`。
- 保留用户已有改动，不重置、不回滚无关工作。
- 保存稳定版优先用 Git tag；基于稳定版开发新功能优先新建分支。
- 每发布一个版本号，都要在该版本的发布提交上打 annotated tag `stable-提示词助手X.Y.Z`，一个版本一个，不能漏。
- 只有用户明确要求“强制回滚 / 覆盖当前代码 / 不要保留当前改动 / 执行 reset --hard”时，才允许 `git reset --hard stable-xxx`，且执行前必须提醒会丢弃未提交的 Git 管理文件改动。
- 会被打包的代码改动必须递增可见应用版本和 package 版本。
- 修改会被打包的源码或配置后，默认必须先运行单元测试和语法检查，再执行完整打包和发布更新。
- 如果后续会执行 `release:publish`，不需要单独提前运行 `npm run build`，因为 `release:publish` 内部会自动 build。
- 完整打包和发布必须保留三类当前版本产物：安装版、便携版、`release/win-unpacked/` 文件夹版。
- 完整发布必须把安装版自动更新文件发布到部署者自己的 `UPDATE_BASE_URL`，并校验 `latest.yml`、安装包和 blockmap 可访问。
- 更新目录只保留当前版本安装包、当前 `.blockmap` 和 `latest.yml`，旧版本安装包和旧 blockmap 要清理。
- 除非用户明确说“不打包”或“不发布”，修改打包源码或配置后不要等待用户单独提醒发布。
- 普通用户不能编辑 Supabase 云端设置。
- 管理员邮箱来自 `VITE_ADMIN_EMAILS`。未配置时本机可以直接修改云端设置。不要把个人邮箱写进仓库。
- 顶部搜索框必须是全局搜索：输入关键词后应在全部提示词中匹配标题、正文、主文件夹、子分类和标签，不受当前选中的分类或子分类限制。
- 新建/导入提示词必须按主文件夹、子标题、内容去重。
- 云同步只使用 Supabase；数据变更必须同时考虑 localStorage 和 Supabase 云同步行为。
- 例外：素材库（图片、视频）不走 Supabase，也不存本机，只存在用户自己的 NAS（WebDAV）上，见 `electron/materials/`。提示词库和文档库的同步规则不受影响。
- 例外：来图定制的产品模板和订单只存在定制专用 NAS 文件夹（WebDAV，连接来自 Supabase 表 `custom_teams`），见 `electron/materials/custom*.ts`。

## 结构约定

目标是长期维护：改一处只影响对应部分。按项目规模落实，不过度设计。

- 业务规则（合并、去重、导入解析、导出序列化、归一）写成纯函数，放在 `src/librarySync.ts`、`src/promptStorage.ts`、`src/promptUtils.ts`，并补 Node 行为测试。
- 每类外部依赖只有一个出入口，其他地方不直接调用：
  - 本机存储读写：
    - 条目和分类在 `src/promptStorage.ts`，其余本机状态在 `src/localState.ts`，新的本机状态也放这里。
    - 例外：云端设置由 `src/cloudSync.ts` 自己存，外观由 `src/lib/theme.ts` 自己存。
  - Supabase 请求：`src/cloudSync.ts`
  - NAS（WebDAV）请求：`electron/materials/webdav.ts`；素材库的读写时机：`src/materials/useMaterialLibrary.ts`
  - 同步时机（登录合并、自动保存、冲突合并、焦点拉取）：`src/useCloudSync.ts`
  - 桌面能力：preload 暴露的 `window.promptAssistantDesktop`
- `src/App.tsx` 只放状态和处理函数；界面组件放 `src/components/`（`ui/` 是 shadcn 基础件），不再往 `App.tsx` 里加组件。
- 新功能有自己的状态或界面时，单独成文件；只是给现有功能加一项时，改原处，不为单次使用造抽象，不建只有一种实现的接口层。
- 删除功能时，连同它的处理函数、参数、样式、测试一起删干净，不留没人调用的代码。
- 地址、密钥、管理员邮箱放 `.env`，不进仓库；从来不变的常量留在代码里，不为它做配置项。
- 看到更好的结构，先提建议并说明理由，不在做别的任务时顺手大改。
