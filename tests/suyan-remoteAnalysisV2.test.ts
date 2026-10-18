// 移植自 SuYan（MIT，guliacer）tests/unit/remoteAnalysisV2.test.ts，只改了导入路径，用 tests/helpers/vitest-shim.mjs 在 node --test 下运行。
import { describe, expect, it } from "./helpers/vitest-shim.mjs";

import {
  legacyFromRemoteAnalysisV2,
  normalizeRemotePromptAnalysisV2,
  remoteAnalysisV2FromLegacy,
} from "../electron/materials/suyan/remoteAnalysisV2.ts";
import type { RemotePromptAnalysisV2 } from "../electron/materials/suyan/aiTypes.ts";

describe("normalizeRemotePromptAnalysisV2", () => {
  it("returns null for flat V1 payloads so the legacy reader can take over", () => {
    expect(
      normalizeRemotePromptAnalysisV2({ title: "t", category: "风景", tags: ["山", "水"], summary: "s" }),
    ).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(normalizeRemotePromptAnalysisV2(null)).toBeNull();
    expect(normalizeRemotePromptAnalysisV2("nope")).toBeNull();
    expect(normalizeRemotePromptAnalysisV2(["风景"])).toBeNull();
  });

  it("returns null when a V2 envelope carries no usable category or tag", () => {
    expect(
      normalizeRemotePromptAnalysisV2({ safety: { rating: "safe", confidence: 0.9 }, categories: [], tags: [] }),
    ).toBeNull();
  });

  it("normalizes structured candidates, clamping confidence and coercing dimensions", () => {
    const result = normalizeRemotePromptAnalysisV2({
      schemaVersion: 2,
      title: "赛博朋克海报",
      summary: "霓虹都市",
      categories: [
        { label: "赛博朋克", confidence: 0.9, evidence: ["霓虹", "雨夜"], primary: true },
        { label: "科幻", confidence: 0.6, evidence: [] },
        "插画",
      ],
      tags: [
        { label: "霓虹灯", dimension: "lighting", confidence: 85 },
        { label: "全身", dimension: "shot", confidence: 0.7 },
        "赛博",
      ],
      safety: { rating: "sfw", confidence: 0.99, evidence: ["无敏感"] },
      warnings: ["低置信", "低置信"],
    });

    expect(result).toEqual({
      schemaVersion: 2,
      title: "赛博朋克海报",
      summary: "霓虹都市",
      categories: [
        { label: "赛博朋克", confidence: 0.9, evidence: ["霓虹", "雨夜"], primary: true },
        { label: "科幻", confidence: 0.6, evidence: [], primary: false },
        { label: "插画", confidence: 0.5, evidence: [], primary: false },
      ],
      tags: [
        { label: "霓虹灯", dimension: "lighting", confidence: 0.85, evidence: [] },
        { label: "全身", dimension: "other", confidence: 0.7, evidence: [] },
        { label: "赛博", dimension: "other", confidence: 0.5, evidence: [] },
      ],
      safety: { rating: "safe", confidence: 0.99, evidence: ["无敏感"] },
      warnings: ["低置信"],
    });
  });

  it("elects the highest-confidence primary when none is flagged", () => {
    const result = normalizeRemotePromptAnalysisV2({
      categories: [
        { label: "a", confidence: 0.3 },
        { label: "b", confidence: 0.8 },
        { label: "c", confidence: 0.5 },
      ],
    });
    expect(result?.categories.find((candidate) => candidate.primary)?.label).toBe("b");
    expect(result?.categories.filter((candidate) => candidate.primary)).toHaveLength(1);
  });

  it("keeps an explicitly flagged primary even at lower confidence", () => {
    const result = normalizeRemotePromptAnalysisV2({
      categories: [
        { label: "a", confidence: 0.9, primary: false },
        { label: "b", confidence: 0.4, primary: true },
      ],
    });
    expect(result?.categories.find((candidate) => candidate.primary)?.label).toBe("b");
  });

  it("dedups by normalized label, keeping the highest-confidence entry", () => {
    const result = normalizeRemotePromptAnalysisV2({
      categories: [
        { label: "猫", confidence: 0.3 },
        { label: " 猫 ", confidence: 0.9 },
      ],
    });
    expect(result?.categories).toHaveLength(1);
    expect(result?.categories[0]).toMatchObject({ label: "猫", confidence: 0.9 });
  });

  it("recognizes a schemaVersion marker even with plain string arrays", () => {
    const result = normalizeRemotePromptAnalysisV2({
      schemaVersion: 2,
      categories: ["风光摄影"],
      tags: ["逆光", "逆光"],
    });
    expect(result?.categories).toEqual([
      { label: "风光摄影", confidence: 0.5, evidence: [], primary: true },
    ]);
    expect(result?.tags).toEqual([{ label: "逆光", dimension: "other", confidence: 0.5, evidence: [] }]);
  });

  it("clamps out-of-range and string confidence values", () => {
    const result = normalizeRemotePromptAnalysisV2({
      categories: [
        { label: "hi", confidence: 150 },
        { label: "lo", confidence: -5 },
        { label: "str", confidence: "0.42" },
        { label: "pct", confidence: "73%" },
      ],
    });
    const byLabel = Object.fromEntries((result?.categories ?? []).map((c) => [c.label, c.confidence]));
    expect(byLabel).toMatchObject({ hi: 1, lo: 0, str: 0.42, pct: 0.73 });
  });
});

describe("remoteAnalysisV2FromLegacy", () => {
  it("lifts a flat V1 result to capped, unverified V2", () => {
    const v2 = remoteAnalysisV2FromLegacy({
      title: "湖边人像",
      category: "写真人像",
      tags: ["逆光", "汉服", "湖景"],
      summary: "柔光人像",
    });

    expect(v2.schemaVersion).toBe(2);
    expect(v2.categories).toEqual([
      { label: "写真人像", confidence: 0.5, evidence: [], primary: true },
    ]);
    expect(v2.tags.map((tag) => tag.label)).toEqual(["逆光", "汉服", "湖景"]);
    expect(v2.tags.every((tag) => tag.dimension === "other")).toBe(true);
    expect(v2.tags[0].confidence).toBe(0.5);
    expect(v2.tags[1].confidence).toBeCloseTo(0.48);
    expect(v2.safety).toEqual({ rating: "unknown", confidence: 0, evidence: [] });
    expect(v2.warnings).toEqual(["legacy-v1-source"]);
  });

  it("produces no category candidate when the legacy category is empty", () => {
    const v2 = remoteAnalysisV2FromLegacy({ title: "", category: "", tags: ["山"], summary: "" });
    expect(v2.categories).toEqual([]);
    expect(v2.tags).toHaveLength(1);
  });
});

describe("legacyFromRemoteAnalysisV2", () => {
  const structured: RemotePromptAnalysisV2 = {
    schemaVersion: 2,
    title: "标题",
    summary: "摘要",
    categories: [
      { label: "主分类", confidence: 0.9, evidence: [], primary: true },
      { label: "次分类", confidence: 0.7, evidence: [], primary: false },
    ],
    tags: [
      { label: "标签A", dimension: "other", confidence: 0.6, evidence: [] },
      { label: "标签B", normalizedLabel: "规范B", dimension: "style", confidence: 0.8, evidence: [] },
    ],
    safety: { rating: "unknown", confidence: 0, evidence: [] },
    warnings: [],
  };

  it("collapses to the flat shape, ordering by confidence and folding secondary genres", () => {
    expect(legacyFromRemoteAnalysisV2(structured)).toEqual({
      title: "标题",
      category: "主分类",
      tags: ["规范B", "标签A", "次分类"],
      summary: "摘要",
    });
  });

  it("round-trips a structured payload through normalize then collapse", () => {
    const normalized = normalizeRemotePromptAnalysisV2({
      schemaVersion: 2,
      title: "海报",
      summary: "",
      categories: [
        { label: "主", confidence: 0.4 },
        { label: "副", confidence: 0.95, primary: true },
      ],
      tags: [{ label: "风格标签", dimension: "style", confidence: 0.5 }],
    });
    expect(normalized).not.toBeNull();
    const collapsed = legacyFromRemoteAnalysisV2(normalized as RemotePromptAnalysisV2);
    expect(collapsed.category).toBe("副");
    expect(collapsed.tags).toEqual(["风格标签", "主"]);
  });
});
