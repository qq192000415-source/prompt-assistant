# 提示词助手皮肤包

皮肤只改外观：配色、壁纸、图标。不碰任何功能和数据。

## 怎么装

设置 → 皮肤 → 「安装皮肤包」选 `.zip`，或者把 `.zip` 拖进那一块。装好后点「使用」，或者在顶部栏的主题菜单里选。

## 怎么做一个

照着 [`_template/`](_template/) 改，然后把**文件夹里的内容**压成 `.zip`（直接压整个文件夹也行）。

```
manifest.json      必需
preview.webp       必需，菜单和设置页里的缩略图，建议 240×135
wallpaper.webp     可选，壁纸，建议 1920×1080，webp 压到 300KB 以内
icons/<名字>.svg   可选，替换软件里的图标
icons/<名字>.png   可选，同上，保留彩色
```

### manifest.json

| 字段 | 说明 |
| --- | --- |
| `id` | 小写字母、数字、`-`，最多 40 个字符。不能和内置皮肤重名（`anime` `gamer` `genshin` `idol` `pokemon` `racing`）。同 id 再装一次就是更新 |
| `name` | 显示的名字，最多 20 个字 |
| `note` | 一句话介绍，可省 |
| `author`、`version` | 作者、版本号 |
| `base` | `light` 或 `dark`：皮肤叠在浅色还是深色主题上。没写的颜色用这套主题的 |
| `tokens` | 要改的颜色，见下表 |
| `wallpaper` | 可选，壁纸，字段见下表 |
| `preview` | 缩略图文件名 |

**壁纸**（`wallpaper` 里的字段）：

| 字段 | 说明 |
| --- | --- |
| `file` | 壁纸文件名 |
| `overlay` | 可选，盖在壁纸上的一层颜色，用来压暗或提亮 |
| `layout` | 可选，摆法：`cover`（默认，铺满窗口）、`right` / `left`（侧边立绘：按窗口高度完整贴在右边或左边，朝内容那边渐隐）。竖图、人物立绘用 `right`，宽窗口时提示词和文档页的内容会让出人物的位置 |
| `focus` | 可选，`cover` 时窗口变窄优先保住的位置，`[横向百分比, 纵向百分比]`，默认 `[50, 50]` |
| `aspect` | 立绘必填：图片宽 ÷ 高，比如 941×1672 的图写 `0.5628` |
| `base` | 可选，立绘时窗口其余地方的底色，建议取图片贴内容那一侧的边缘色 |

素材、画布页满屏都是用户自己的图，壁纸会自动变淡退到后面。不想手写这些，可以在软件里「设置 → 皮肤 → 做一套皮肤」选图生成，再导出成 `.zip`。

**能改的颜色**（只认这些，写别的会装不上）：

| 令牌 | 用在哪 |
| --- | --- |
| `--surface-quiet` | 页面底色。有壁纸时设成半透明，壁纸才透得出来 |
| `--sidebar` | 侧栏、顶部栏 |
| `--surface` | 卡片、输入框 |
| `--surface-muted` | 次一级的底，比如标签、分组 |
| `--surface-raised` | 浮起来的栏（吸顶标题栏、顶部栏）；有壁纸时保持接近不透明 |
| `--overlay-surface` | 下拉菜单、弹窗；建议不透明 |
| `--hover` | 鼠标悬停的底 |
| `--border`、`--border-strong` | 边线 |
| `--text`、`--muted`、`--faint` | 正文、次要文字、提示文字 |
| `--accent`、`--accent-hover`、`--accent-weak` | 强调色（主按钮、选中）、悬停、浅底 |
| `--on-accent` | 主按钮上的字 |
| `--global`、`--global-weak` | 全局搜索的颜色 |
| `--danger`、`--danger-weak`、`--success`、`--warning`、`--warning-weak` | 状态色 |
| `--shadow`、`--shadow-soft` | 阴影 |

值只能是颜色（`#rrggbb`、`rgba(…)`）或阴影，不能有 `url(`、引号、分号、花括号。

**请检查对比度**：正文、次要文字在 `--surface` 上，主按钮的字在 `--accent` 上，都要 ≥ 4.5:1，不然看不清。

### 图标

文件名就是 [lucide](https://lucide.dev/icons/) 的图标名，比如 `icons/star.svg` 替换所有的星星。常用的：

| 位置 | 图标名 |
| --- | --- |
| 顶部栏：提示词 / 文档 / 素材 / 画布 | `book-open` `file-text` `images` `palette` |
| 侧栏：全部 / 收藏 / 最近使用 / 删除记录 | `layout-list` `star` `clock-3` `rotate-ccw` |
| 搜索、新建、设置、文件夹、复制 | `search` `plus` `settings` `folder` `copy` |

- `.svg` 当剪影用：形状不透明的地方显示成文字的颜色，所以图标会跟着强调色变色。用实心填充，24×24 的画布。
- `.png` 原样显示，保留彩色，建议 48×48 透明底。

### 限制

整个包 20MB 以内；单张图片 8MB 以内；单个图标 200KB 以内，最多 300 个；只能有上面列出的文件，多了会装不上并告诉你是哪个文件。

## 投稿到主题市场

软件的「设置 → 皮肤 → 主题市场」列出的就是本目录里的皮肤（`_` 开头的文件夹除外）。

1. 把皮肤文件夹放进 `themes/<id>/`，文件夹名和 `manifest.json` 里的 `id` 一致，不能和内置皮肤、已有的皮肤重名。
2. 运行 `npm run themes:build`：会用软件里同一套规则校验每个皮肤，生成 `themes/dist/<id>.zip`、预览图和 `themes/index.json`。校验不过会说明原因。
3. 把 `themes/<id>/`、`themes/dist/`、`themes/index.json` 一起提 Pull Request。更新皮肤时把 `version` 改大，用户那边会显示「更新到 vX」。

请只投自己有权使用的图片。
