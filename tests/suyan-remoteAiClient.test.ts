// 移植自 SuYan（MIT，guliacer）tests/unit/remoteAiClient.test.ts，只改了导入路径，用 tests/helpers/vitest-shim.mjs 在 node --test 下运行。
// 没搬的用例（依赖 vi 模拟或测的是生图）：does not retry an aborted request after the analysis deadline；forces non-streaming requests and rebuilds SSE chat chunks；builds Agnes Video 2.5 keyframe requests with the documented fields；normalizes image-only canvas ratios and labels multi-image references；keeps more than five references for Agnes Video 2.5 regular；uses v2.0 frame parameters and keyframe extra_body；creates, polls, and downloads an Agnes video task；appends resolved image-generation instructions to the final prompt；supplements short upstream batches and logs sanitized request settings；rebuilds reference-image FormData for every supplemental request；uses downloaded file signatures instead of response content-type；keeps provider output even when format / size settings were ignored；accepts provider size bucketing when the aspect ratio is preserved；keeps alpha/opacity mismatched output with a warning instead of rejecting；fails clearly when supplemental requests still cannot satisfy n。请求和重试由 tests/materials-ai.test.mjs 用本地模拟服务覆盖。
import { describe, expect, it } from "./helpers/vitest-shim.mjs";

import {
  buildPromptCategoryAnalysisUserText,
  buildPromptTagsAnalysisUserText,
  buildImageAnalysisUserText,
  buildRemoteNetworkFailureMessage,
  buildRemoteRequestFailureMessage,
  buildSystemAnalysisContent,
  normalizeChatEndpoint,
  normalizeModelsEndpoint,
  parseRemoteChatCompletionResponseBody,
  parseRemoteModels,
  parseRemoteOptimizedPromptContent,
  parseRemoteReversedImagePromptContent,
  parseRemotePromptAnalysisV2Content,
  resolveVisionImagePayloadPolicy,
  requestChatCompletions,
} from "../electron/materials/suyan/remoteAiClient.ts";

const imageProviderSettings = {
  apiKey: "test-key",
  baseUrl: "https://api.example.com/v1",
  enabled: true,
  id: "image-profile",
  model: "image-model",
  models: [],
  name: "image provider",
};
const transparentPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
const opaquePngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

describe("remoteAiClient", () => {


  it("accepts a UTF-8 BOM and a data envelope around a chat response", () => {
    expect(parseRemoteChatCompletionResponseBody(
      '\uFEFF{"data":{"choices":[{"message":{"content":"可用结果"}}]}}',
    )).toEqual({ choices: [{ message: { content: "可用结果" } }] });
  });

  it("appends /chat/completions to the normalized base URL", () => {
    expect(normalizeChatEndpoint("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/chat/completions");
    expect(normalizeChatEndpoint("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
  });

  it("appends /models to the normalized base URL", () => {
    expect(normalizeModelsEndpoint("https://api.openai.com/v1")).toBe("https://api.openai.com/v1/models");
    expect(normalizeModelsEndpoint("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/models",
    );
  });






  it("parses remote model lists with guessed capabilities", () => {
    expect(
      parseRemoteModels({
        data: [{ id: "DeepSeek-V4-Flash" }, { id: "Qwen/Qwen3.6-35B-A3B-FP8" }, { id: "gpt-4o-mini" }],
      }),
    ).toEqual([
      { id: "DeepSeek-V4-Flash", label: "DeepSeek-V4-Flash", capabilities: ["text"] },
      { id: "Qwen/Qwen3.6-35B-A3B-FP8", label: "Qwen/Qwen3.6-35B-A3B-FP8", capabilities: ["text"] },
      { id: "gpt-4o-mini", label: "gpt-4o-mini", capabilities: ["text", "vision"] },
    ]);
  });

  it("prefers platform modality fields over name-based guessing", () => {
    expect(
      parseRemoteModels({
        data: [
          // 名称正则判 text，但平台声明支持图片输入 → 以平台为准
          { id: "DeepSeek-V4", input_modalities: ["text", "image"], output_modalities: ["text"] },
          // 平台声明纯图片输出、无视觉输入 → 生图模型
          { id: "qwen-image", output_modalities: ["image"], input_modalities: ["text"] },
          // vision 布尔字段 → 多模态
          { id: "gpt-oss-120b", vision: true },
          // supports_image 字符串字段 → 多模态
          { id: "kolors", supports_image: "true" },
        ],
      }),
    ).toEqual([
      { id: "DeepSeek-V4", label: "DeepSeek-V4", capabilities: ["text", "vision"] },
      { id: "qwen-image", label: "qwen-image", capabilities: ["image-generation"] },
      { id: "gpt-oss-120b", label: "gpt-oss-120b", capabilities: ["text", "vision"] },
      { id: "kolors", label: "kolors", capabilities: ["text", "vision"] },
    ]);
  });

  it("falls back to name-based guessing when platform fields are absent", () => {
    expect(
      parseRemoteModels({
        data: [{ id: "gpt-4o" }, { id: "dall-e-3" }, { id: "deepseek-v4-pro" }],
      }),
    ).toEqual([
      { id: "gpt-4o", label: "gpt-4o", capabilities: ["text", "vision"] },
      { id: "dall-e-3", label: "dall-e-3", capabilities: ["image-generation"] },
      { id: "deepseek-v4-pro", label: "deepseek-v4-pro", capabilities: ["text"] },
    ]);
  });

  it("treats unknown modality fields as text-only", () => {
    expect(
      parseRemoteModels({
        data: [{ id: "some-model", input_modalities: ["text"] }, { id: "another-model", modalities: [] }],
      }),
    ).toEqual([
      { id: "some-model", label: "some-model", capabilities: ["text"] },
      { id: "another-model", label: "another-model", capabilities: ["text"] },
    ]);
  });

  it("keeps small vision images inline and downgrades larger ones to thumbnails", () => {
    expect(resolveVisionImagePayloadPolicy(512 * 1024)).toMatchObject({
      useOriginal: true,
      useThumbnail: false,
      thumbnailMaxSize: 960,
      thumbnailQuality: 72,
    });
    expect(resolveVisionImagePayloadPolicy(3 * 1024 * 1024)).toMatchObject({
      useOriginal: false,
      useThumbnail: true,
      thumbnailMaxSize: 960,
      thumbnailQuality: 72,
    });
  });

  it("always uses the compact thumbnail policy for safety grading images", () => {
    expect(resolveVisionImagePayloadPolicy(512 * 1024, { compact: true, purpose: "safety" })).toMatchObject({
      useOriginal: false,
      useThumbnail: true,
      thumbnailMaxSize: 640,
      thumbnailQuality: 65,
    });
  });

  it("never feeds the negative prompt into category / tag analysis", () => {
    // 负向词描述「要避免的内容」，进了分析就会被反向当成画面事实：
    // 写了「不要食物、产品」反而判成 食品摄影 / 产品摄影。
    const secret = "不要出现食物，避免产品，禁止模糊";
    const payload = {
      target: "prompt-category" as const,
      title: "湖边人像",
      prompt: "汉服少女，湖边，逆光",
      negativePrompt: secret,
      tags: [],
      category: "未分类",
    };

    expect(buildPromptCategoryAnalysisUserText(payload)).not.toContain(secret);
    expect(buildPromptTagsAnalysisUserText({ ...payload, target: "prompt-tags" })).not.toContain(secret);
    // 正向内容仍然完整送达
    expect(buildPromptCategoryAnalysisUserText(payload)).toContain("汉服少女，湖边，逆光");
  });

  it("keeps a higher-fidelity thumbnail for category analysis", () => {
    // 分类靠材质/笔触/景别区分（写真人像 vs 人物艺术、厚涂插画 vs 写实 CG），
    // 压得太狠会直接导致误分类，因此比标签/安全分级保留更多细节。
    expect(resolveVisionImagePayloadPolicy(512 * 1024, { purpose: "category" })).toMatchObject({
      useOriginal: false,
      useThumbnail: true,
      thumbnailMaxSize: 1024,
      thumbnailQuality: 82,
    });
  });

  it("separates real scenes from studio location and studio lighting", () => {
    const text = buildImageAnalysisUserText({
      target: "image-category",
      title: "凤冠霞帔人像",
      imageFileName: "portrait.png",
      prompt: "",
      negativePrompt: "",
      tags: [],
      category: "",
    });

    expect(text).toContain("有幕布不等于有无缝背景，有布景不等于影棚");
    expect(text).toContain("棚拍光");
    expect(text).toContain("不能因为选了棚拍光就追加「专业影棚」");
    expect(text).toContain("无法确认是影棚时，不得猜选「专业影棚」");
  });

  it("uses lighter thumbnails for tags vision analysis", () => {
    expect(resolveVisionImagePayloadPolicy(512 * 1024, { purpose: "tags" })).toMatchObject({
      useOriginal: false,
      useThumbnail: true,
      thumbnailMaxSize: 768,
      thumbnailQuality: 70,
    });
  });

  it("rejects invalid endpoint protocols", () => {
    expect(() => normalizeChatEndpoint("ftp://api.example.com/v1")).toThrow(
      "AI 接口地址必须以 http 或 https 开头。",
    );
  });

  it("includes provider JSON error details in API test failures", () => {
    expect(
      buildRemoteRequestFailureMessage(401, JSON.stringify({ error: { message: "invalid api key sk-secret123456" } })),
    ).toBe("远程 AI 请求失败，状态码 401。原因：invalid api key sk-****");
  });

  it("includes compact plain text error details in API test failures", () => {
    expect(buildRemoteRequestFailureMessage(502, "Bad gateway from upstream")).toBe(
      "远程 AI 请求失败，状态码 502。原因：Bad gateway from upstream",
    );
  });

  it("includes network cause details in API test failures", () => {
    const error = new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND api.example.com"),
    });

    expect(buildRemoteNetworkFailureMessage(error)).toBe(
      "远程 AI 请求失败，网络原因：getaddrinfo ENOTFOUND api.example.com",
    );
  });

  it("parses optimized prompt text without markdown fences or labels", () => {
    expect(parseRemoteOptimizedPromptContent("```text\n优化后提示词：雨天街拍女孩\n```")).toBe("雨天街拍女孩");
  });

  it("extracts only the optimized prompt when legacy optimize-and-analysis output appears", () => {
    expect(
      parseRemoteOptimizedPromptContent("【一】优化后提示词：雨天街拍女孩，电影感自然光\n\n【二】参数胶囊结构\nstyle = 电影感"),
    ).toBe("雨天街拍女孩，电影感自然光");
  });

  it("removes orphan leading punctuation from optimized prompt output", () => {
    expect(parseRemoteOptimizedPromptContent("，智能手机摄影风格，近距离人像，柔和自然光")).toBe(
      "智能手机摄影风格，近距离人像，柔和自然光",
    );
  });

  it("removes bullet wrappers while keeping prompt body punctuation", () => {
    expect(parseRemoteOptimizedPromptContent("- 竖版 9:16 构图，人物位于画面中央\n- 光影柔和，背景干净")).toBe(
      "竖版 9:16 构图，人物位于画面中央\n光影柔和，背景干净",
    );
  });

  it("parses reversed image prompt text without markdown fences or labels", () => {
    expect(parseRemoteReversedImagePromptContent("```text\n图像反推提示词：半身人像，柔和自然光 --ar 3:4\n```")).toBe(
      "半身人像，柔和自然光 --ar 3:4",
    );
  });

  it("recovers a truncated V2 analysis payload via bracket repair", () => {
    const v2 = parseRemotePromptAnalysisV2Content(
      '{"schemaVersion":2,"title":"山水","categories":[{"label":"风光摄影","confidence":0.88,"primary":true}],"tags":[{"label":"远景","dimension":"composition","confidence":0.7}],"safety":{"rating":"saf',
    );

    expect(v2.categories[0].label).toBe("风光摄影");
    expect(v2.tags.map((tag) => tag.label)).toEqual(["远景"]);
  });

  it("lifts a flat V1 response into a low-confidence V2 envelope", () => {
    const v2 = parseRemotePromptAnalysisV2Content(
      '{"title":"湖边人像","category":"写真人像","tags":["逆光","汉服"],"summary":"柔光"}',
    );

    expect(v2.schemaVersion).toBe(2);
    expect(v2.warnings).toEqual(["legacy-v1-source"]);
    expect(v2.categories[0]).toMatchObject({ label: "写真人像", primary: true });
    expect(v2.categories[0].confidence).toBeLessThanOrEqual(0.5);
    expect(v2.tags.map((tag) => tag.label)).toEqual(["逆光", "汉服"]);
    expect(v2.safety.rating).toBe("unknown");
  });

  it("normalizes a genuine V2 response without the legacy warning", () => {
    const v2 = parseRemotePromptAnalysisV2Content(`
\`\`\`json
{
  "schemaVersion": 2,
  "categories": [{ "label": "风光摄影", "confidence": 0.9, "primary": true }],
  "tags": [{ "label": "远景", "dimension": "composition", "confidence": 0.7 }],
  "safety": { "rating": "safe", "confidence": 0.95 }
}
\`\`\`
`);

    expect(v2.categories[0]).toMatchObject({ label: "风光摄影", confidence: 0.9, primary: true });
    expect(v2.tags[0].dimension).toBe("composition");
    expect(v2.safety.rating).toBe("safe");
    expect(v2.warnings).not.toContain("legacy-v1-source");
  });

  it("instructs category targets to emit the structured V2 envelope", () => {
    for (const target of ["image-category", "prompt-category"] as const) {
      const system = buildSystemAnalysisContent(target);
      // 顶层 V2 契约字段
      expect(system).toContain("schemaVersion");
      expect(system).toContain("categories（数组）");
      // 每个分类候选的结构：confidence / evidence / primary
      expect(system).toContain('"confidence"');
      expect(system).toContain('"evidence"');
      expect(system).toContain('"primary"');
      // 分类任务不产出标签，safety 固定 unknown
      expect(system).toContain("tags 必须为空数组");
      expect(system).toContain('"rating":"unknown"');
      // 不得再要求扁平 V1 字段
      expect(system).not.toContain("JSON 字段必须为：title、category、tags、summary。");
    }
  });

  it("instructs tag targets to emit dimension-tagged V2 candidates", () => {
    for (const target of ["image-tags", "prompt-tags"] as const) {
      const system = buildSystemAnalysisContent(target);
      expect(system).toContain("schemaVersion");
      expect(system).toContain('"dimension"');
      expect(system).toContain('"confidence"');
      // 维度取值集合必须完整暴露给模型
      expect(system).toContain("composition");
      expect(system).toContain("lighting");
      // 标签任务不产出分类
      expect(system).toContain("categories 必须为空数组");
      expect(system).not.toContain("JSON 字段必须为：title、category、tags、summary。");
    }
  });

  it("instructs image-safety to emit the structured V2 safety verdict", () => {
    const system = buildSystemAnalysisContent("image-safety");
    // 安全分级迁到 V2 结构化：判定写进 safety 对象，而非扁平 category
    expect(system).toContain("schemaVersion");
    expect(system).toContain("safety（对象）");
    expect(system).toContain('"rating":"safe"');
    expect(system).toContain("rating 只能是 safe、nsfw 或 unknown");
    expect(system).toContain('"confidence"');
    // 安全任务不产出分类/标签
    expect(system).toContain("categories 与 tags 必须为空数组");
    // 不再使用扁平 V1 契约，也不再把 SFW/NSFW 塞进 category
    expect(system).not.toContain("JSON 字段必须为：title、category、tags、summary。");
    expect(system).not.toContain("SFW、NSFW 或 UNKNOWN");
  });








});
