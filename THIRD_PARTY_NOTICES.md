# 第三方代码声明

## FFmpeg（按需下载的组件，不在安装包里）

素材库的视频压缩会在第一次使用时，从部署者的更新源 `components/` 目录下载 FFmpeg 程序，下载后校验 SHA256 再启用。

- 构建：gyan.dev FFmpeg 8.1.2 essentials（Windows 64 位静态构建），原样分发，未修改。
- 协议：GPL v3。协议全文和构建说明随程序一起放在更新源：`components/ffmpeg-8.1.2-essentials_build-www.gyan.dev-LICENSE.txt`、`components/ffmpeg-8.1.2-essentials_build-www.gyan.dev-README.txt`。
- 对应源码：https://github.com/FFmpeg/FFmpeg/commit/38b88335f9 ；构建来源：https://www.gyan.dev/ffmpeg/builds/ 、https://github.com/GyanD/codexffmpeg/releases/tag/8.1.2
- 提示词助手通过命令行调用这个独立程序，没有链接 FFmpeg 的库。

## SuYan（素言）

素材库的部分代码移植自 [guliacer/SuYan](https://github.com/guliacer/SuYan)，按 MIT 协议使用。移植过的文件在文件开头注明了来源：

- `src/materials/mediaFileTypes.ts`：媒体扩展名定义
- `src/materials/library.ts`：同组效果图的分组规则、组内排序、提示词文本规整、标签去重
- `electron/materials/ffmpeg.ts`：视频编码器选择（显卡编码优先、软件编码兜底）、FFmpeg 参数、时长和进度解析
- `electron/materials/batch.ts`：批量压缩的流程（逐个处理、变小才替换、失败逐条报告）
- `electron/materials/suyan/`：原样移植，只改了导入路径
  - `promptImportParser.ts`：各站点分享链接和提示词文本的解析器
  - `shareSourceFetchers.ts`：抓取层，`net.fetch` 换成了抓取专用会话
  - `jimengHiddenFetch.ts`：即梦隐藏窗口抓取
  - `generationModels.ts`、`promptTitle.ts`
  - `wordDocumentImport.ts`：Word 图文的解析和配对
  - `placeholderImage.ts`：占位图生成
  - `remoteAiClient.ts`（只取文本和视觉部分，去掉了生图）、`ollamaAiClient.ts`：AI 请求、系统提示词、结果解析
  - `aiTypes.ts`：AI 功能定义和各功能的预设规则
  - `photographyCategories.ts`：摄影分类体系；`tagKnowledge.ts`、`tagEntityGroups.ts`、`tagQuality.ts`、`tagKnowledgeTypes.ts`：标签规范
  - `remoteAnalysisV2.ts`、`aiBaseUrl.ts`：分析结果归一、接口地址规整
- `electron/jimengCapture.cjs`：即梦抓取用的 preload
- `electron/materials/linkImport.ts`、`wordImport.ts`：剪贴板、链接、Word 导入流程
- `electron/materials/sharePackage.ts`：分享包格式（`data.json` + `images/`，和素言互通）
- `tests/suyan-*.test.ts`：SuYan 自带的解析器和 AI 客户端单元测试（依赖 vi 模拟的用例没搬，文件开头列了名字），原样搬来，通过 `tests/helpers/vitest-shim.mjs` 在 `node --test` 下运行

```text
MIT License

Copyright (c) 2026 SuYan / guliacer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the Software), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
