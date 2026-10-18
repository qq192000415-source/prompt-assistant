// 原样移植自 SuYan（MIT，guliacer）src/features/library/types/tagKnowledge.ts。
// 只改了导入路径；要跟进 SuYan 时，直接和上游这个文件对比。
export type TagKnowledge = {
  aliases?: string[];
  groupLocked?: boolean;
  reviewStatus?: "accepted" | "pending" | "noise";
  analysis?: {
    dimension: string;
    confidence: number;
    evidence: string[];
    suggestedGroup?: string;
  };
};

export type TagOrganizationRow = {
  id: string;
  originalLabel: string;
  originalGroup: string;
  label: string;
  group: string;
  status: "accepted" | "pending" | "noise";
  reason: string;
  workCount: number;
  suggested: boolean;
  /** Standard group conflicts are review suggestions; locked entries are not preselected. */
  correction?: boolean;
  selected: boolean;
  analysis?: TagKnowledge["analysis"];
};

export type TagOrganizationPreview = {
  revision: string;
  rows: TagOrganizationRow[];
  undoAvailable: boolean;
};

export type TagOrganizationRequest = {
  revision: string;
  choices: Array<{ id: string; label: string; group: string }>;
};
