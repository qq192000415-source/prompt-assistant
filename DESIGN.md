---
name: 提示词助手
description: 管理提示词、文档与 AI 素材的 Windows 桌面工具
colors:
  accent: "#2563eb"
  accent-hover: "#1d4ed8"
  accent-weak: "#eaf1ff"
  on-accent: "#ffffff"
  global: "#0f766e"
  global-weak: "#e7f6f3"
  text: "#18181b"
  muted: "#6d727c"
  faint: "#9aa1ad"
  surface: "#ffffff"
  surface-quiet: "#f7f9fc"
  surface-muted: "#f4f6f9"
  sidebar: "#f3f5f8"
  border: "#e6e8ee"
  border-strong: "#d5d8e1"
  danger: "#dc3d3d"
  danger-weak: "#fff1f1"
  success: "#16a34a"
  warning: "#b45309"
  warning-weak: "#fff8eb"
typography:
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "20px"
    fontWeight: 600
  heading:
    fontFamily: "Segoe UI Variable Text, Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI Variable, Segoe UI, Microsoft YaHei UI, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  code:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "0.9em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 10px"
  chip-category:
    backgroundColor: "{colors.accent-weak}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  chip-tag:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    height: "22px"
    padding: "0 8px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "12px"
---

# Design System: 提示词助手

## Overview

**Creative North Star: "整洁的卡片柜 (The Tidy Card Cabinet)"**

每一条提示词、每一个文档、每一张素材都像归好位的卡片：放在哪里一眼可见，取用只要一步。界面是安静的浅色工作台，只在需要动作的地方出现一抹蓝。所有装饰都服从「找到即复制」。

密度中等偏高，适合长时间常驻在桌面上。层次靠浅灰的底面、白色的卡片和极淡的描边区分，不靠大面积色块或渐变。支持暗色模式，暗色下令牌整体替换（见 `src/styles.css` 的 `.dark` 块）。

**Key Characteristics:**
- 浅灰底面（surface-quiet）上放白色卡片，描边 1px。
- 单一蓝色强调，只用于主按钮、选中状态和分类徽标。
- 青绿色专门表示「全局搜索」，不挪作他用。
- 中文界面，系统字体 Segoe UI Variable 和微软雅黑。

## Colors

整体是克制的冷灰中性色，配一个蓝色强调和一个专用青绿色。

### Primary
- **工作蓝 Work Blue**（accent）：主按钮、选中项、焦点环、分类徽标的文字色。浅底版本（accent-weak）用于选中背景和焦点外发光。

### Secondary
- **全局青 Global Teal**（global）：只用于全局搜索状态，包括搜索框描边和「全局」胶囊。

### Neutral
- **墨色 Ink**（text）：正文和标题。
- **石灰 Slate Muted**（muted）：次要文字、计数、元信息。
- **淡灰 Faint**（faint）：只用于图标或分隔，不用于需要阅读的文字，因为对比度不够。
- **白卡 Surface**（surface）、**静底 Quiet Ground**（surface-quiet）、**柔底 Muted Ground**（surface-muted）、**侧栏 Sidebar**（sidebar）：从卡片到底面的四层中性。
- **细线 Hairline**（border）和**实线 Firm Line**（border-strong）：描边和输入框边框。

### Status
- danger、success、warning 及其 weak 浅底，用于删除确认、连接状态和精选。

### Named Rules
**一处蓝 The One Blue Rule.** 同一屏里蓝色只标出「下一步该点哪里」和「当前选中的是什么」，其余一律中性色。

**青绿专用 The Teal Is Global Rule.** 青绿色只表示全局搜索，别的状态不能借用。

### Themes（1.8.6）
外观有四套主题，只换颜色令牌，组件、字体、圆角、间距都不变。顶部栏的主题菜单和设置页「通用 › 外观」都能切换，只存本机。
- **浅色 light**：上面这套冷灰中性加工作蓝，是默认。
- **深色 dark**：同一套蓝色强调，底面换成冷黑。
- **米白 cream**：Claude 桌面端的暖米底（`#faf9f5` / 侧栏 `#f0eee6`），暖墨色字，强调色是加深的赭橙 `#b4532f`（和白字对比 ≥4.5:1）。
- **暖夜 ember**：Claude 深色的暖灰底（`#262624`），强调色提亮成 `#d97757`，所以按钮上的字用深色 `#1f1e1d`。

「一处蓝」在米白、暖夜里就是「一处赭橙」：强调色只换颜色，不换用法。全局搜索的青绿在四套里都不变。新加颜色一律写成令牌或 `color-mix(… var(--accent) …)`，不要写死蓝色。

## Typography

**Body Font:** Segoe UI Variable Text（备选 Segoe UI、Microsoft YaHei UI、Microsoft YaHei）
**Mono Font:** Cascadia Code（备选 Consolas），只用于 Markdown 文档里的代码

**Character:** 跟随 Windows 系统字体，中文和西文的字重、字宽一致，看起来像系统自带的工具。

### Hierarchy
- **Title**（600，20px）：板块标题，例如「素材库」。
- **Heading**（600，16–18px）：详情面板和弹窗的标题。
- **Body**（400，14px，行高 1.55）：正文、提示词内容、按钮文字。
- **Small**（400，13px）：工具栏控件、次要按钮。
- **Label**（600，12px）：字段名（「正向提示词」）、徽标、计数。

## Layout

- 窗口结构：顶部主导航 48px（左边四个库的标签，右边云同步状态、深浅色、设置），下面是侧栏加内容区；素材、画布、设置页没有侧栏（设置页左边是 220px 的分类栏）。
- 内容区最大宽度约 1240px，左右内边距 20px，区块间距 16px。
- 卡片网格用 `repeat(auto-fill, minmax(220px, 1fr))`，间距 16px，窗口变窄时自动减少列数。
- 工具栏用 flex-wrap，窄窗口下自动换行。

## Elevation & Depth

以平面为主，层次靠底色区分。阴影只有两档，只用在浮起的东西上：
- **柔影 shadow-soft**（`0 10px 28px rgba(24,24,27,.08), 0 0 0 1px rgba(24,24,27,.04)`）：下拉菜单、悬停中的卡片。
- **浮影 shadow**（`0 18px 40px rgba(24,24,27,.1), 0 0 0 1px rgba(24,24,27,.04)`）：弹窗、对话框。

**静止即平面 The Flat At Rest Rule.** 卡片静止时只有描边，悬停或打开时才出现阴影。

## Shapes

- 小控件 6–7px 圆角，按钮和输入框 8px，卡片和弹窗 12px，徽标和筛选胶囊做成全圆角。
- 不使用切角，也不用粗描边。

## Components

### Buttons
- **Primary**：工作蓝底、白字，高 34–36px，圆角 8px，字重 600；悬停时换成 accent-hover。
- **Outline**：白底、细线描边、墨色字，高 30–32px，用于次要操作（复制图片、编辑）。
- **Ghost / Icon**：透明底，悬停时铺一层极淡的灰（hover 令牌）；只有图标的按钮必须带 `aria-label`。
- **Danger**：红色文字的幽灵按钮。确认删除时才出现红底按钮。

### Chips
- **分类徽标**：accent-weak 底、工作蓝字，全圆角，字重 600。
- **标签**：柔底、墨色字，全圆角。
- **分类筛选标签页**（素材库）：未选中是白底加细线描边，选中是墨色底白字，后面带计数。

### Cards / Containers
- 白卡、12px 圆角、细线描边、不加阴影。悬停时描边变成 firm line，加上柔影。
- 素材卡片：上面是 4:3 预览图，下面依次是标题加分类徽标、两行提示词摘要、标签，底部是「复制提示词」和「精选」两个操作。
- 记录 + 详情栏（画布生成记录）：列表或网格里只负责选中，操作全放在右侧详情栏；选中项是工作蓝描边加浅蓝底（缩略图用 2px 蓝色 outline）。AI 生成的图一律按原比例完整显示（contain，柔底衬底），不裁成正方形。详情栏可拖宽，拖手平时隐形，悬停时出现一条蓝色细条。
- 文件夹视图（文档库）：提示词是「读一段、复制走」，用整条展开的卡片流；文档是「找到文件、复制或拖出去」，用文件列表加右侧预览栏，两个库一眼分得开。列表行 = 类型色块（40px，大写扩展名）+ 名称和一行配套指令 + 大小 + 添加日期 + 复制文件按钮；选中行是 7% 强调色底加 1px 强调色内描边。类型色块用 `--doc-word / pdf / sheet / slide / markdown / other` 令牌（深色主题各有提亮版），底色是同色 14% 混进卡片底；新增类型颜色要在四套主题里都量到 ≥4.5:1。

### Inputs / Fields
- 白底、细线描边、8px 圆角，高 34px。聚焦时描边转蓝，外加 3px accent-weak 光环。

### Navigation
- 「提示词 | 文档 | 素材」三个库的切换是分段控件：灰色槽里放白色滑块，选中项字重 600，带一层微弱阴影。

## Do's and Don'ts

### Do:
- **Do** 让最常用的动作（复制）在卡片上一步可达。
- **Do** 选中状态用工作蓝描边加 accent-weak 背景或光环来表示。
- **Do** 暗色模式下使用令牌，不要写死颜色。

### Don't:
- **Don't** 把青绿色用在全局搜索以外的地方。
- **Don't** 给静止的卡片加阴影，或用渐变铺背景。
- **Don't** 用 faint 色写需要阅读的文字。
