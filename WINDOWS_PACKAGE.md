# 提示词助手 Windows 打包说明

## 版本和文件命名规则

每次修改会被打包的源码或配置后，界面版本号和打包版本号都递增一位，例如 `1.3.17` 改为 `1.3.18`。

安装版文件命名：

```text
提示词助手安装版X.Y.Z.exe
```

便携版文件命名：

```text
提示词助手便携版X.Y.Z.exe
```

文件夹版固定保留：

```text
release/win-unpacked/
```

## 输出保留规则

源码修改并打包后，`release/` 必须保留当前版本的三类输出：

- `提示词助手安装版X.Y.Z.exe`
- `提示词助手便携版X.Y.Z.exe`
- `win-unpacked/` 文件夹版
- `latest.yml` 和安装版 `.blockmap`，用于安装版自动更新

清理旧包时可以删除旧版本 exe、旧 blockmap 和旧缓存文件，但不能删除当前版本的 `win-unpacked/`。

## 常用命令

生成便携版并保留文件夹版：

```bash
npm run package:win
```

只生成文件夹版：

```bash
npm run package:unpacked
```

生成安装版、便携版和文件夹版：

```bash
npm run package:all
```

打包并自动发布到自有腾讯云服务器更新源：

```bash
npm run release:publish
```

## 自动更新发布

自动更新只支持 Windows 安装版。更新地址写在 `.env` 的 `UPDATE_BASE_URL`，指向部署者自己的 HTTPS 目录。打包命令会先运行 `scripts/write-update-source.cjs`，把这个地址写入被 Git 忽略的 `electron/app-update-source.local.json`。地址为空时，安装版不检查更新。

默认上传目录是：

```text
/opt/prompt-assistant-updates/win
```

可用 `UPDATE_SERVER_REMOTE_DIR` 改成自己的目录。

每次发布新版本时，把下面文件上传到该目录：

```text
release/latest.yml
release/提示词助手安装版X.Y.Z.exe
release/提示词助手安装版X.Y.Z.exe.blockmap
```

项目发布脚本 `scripts/publish-update-to-server.cjs` 会执行这些动作：

- 从环境变量或 `.env` 读取 `UPDATE_SERVER_HOST`、`UPDATE_SERVER_USER`、`UPDATE_SERVER_SSH_KEY`、`UPDATE_BASE_URL`。缺任何一项都会停止。
- 通过 SSH 确认服务器目录存在。
- 先上传当前安装包和当前 blockmap，最后上传 `latest.yml`。
- 清理目录下旧 `.exe` 和旧 `.blockmap`，只保留当前版本。
- 通过 `UPDATE_BASE_URL` 校验 `latest.yml`、安装包和 blockmap 可访问且大小一致。

不要把服务器密码、SSH 私钥或真实服务器地址写入仓库。

安装版启动后会自动检查 `latest.yml`，运行期间也会定时检查。发现新版本时用系统通知/托盘提示用户是否下载；用户选择“是，下载”才开始下载。用户也可以在“设置 / 软件更新 / 检查更新”里手动检查，下载完成后点击“重启安装”完成升级。

便携版和 `win-unpacked/` 不支持自动更新，仍用于临时测试、免安装场景和本机排查。

## 开发调试桌面版

先启动网页开发服务：

```bash
npm run dev
```

再开一个终端启动桌面壳：

```bash
npm run desktop:dev
```

也可以双击 `桌面版测试启动.bat` 直接启动当前源码的桌面测试版。

## 云同步

云同步只使用 Supabase Auth 和 `prompt_libraries` 表。Supabase URL 和 publishable key 会在构建时写入前端产物。配置了 `VITE_ADMIN_EMAILS` 时，只有这些账号登录后能修改 Supabase 配置。未配置管理员时，本机可以直接修改。

如果以后拿到旧服务器的 `store.json`，可以在本机离线导入到 Supabase：

```bash
node scripts/import-vps-store-to-supabase.cjs C:\path\to\store.json
```

该脚本只读取本地 JSON 文件，用 `SUPABASE_SERVICE_ROLE_KEY` 在 Supabase Auth 中按邮箱匹配或创建用户，再把快照 upsert 到 `prompt_libraries`。旧 bcrypt 密码哈希不会迁移，迁移后的账号通过 Supabase 重置密码流程设置新密码。
