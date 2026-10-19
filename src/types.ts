export type DocumentFile = {
  name: string;
  size: number;
  sha256: string;
  addedAt: string;
};

// kind 为 'document' 的条目是文档库里的文件；不填就是提示词。
export type PromptItem = {
  id: string;
  kind?: 'document';
  file?: DocumentFile;
  title: string;
  description?: string;
  content: string;
  category: string;
  subcategory?: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type DeletedPromptRecord = {
  id: string;
  prompt: PromptItem;
  deletedAt: string;
  source: 'prompt' | 'category';
  sourceName: string;
  // 用户恢复、移除或清空过的记录不真删，只是不再显示：多台设备合并删除记录时取并集，真删的话另一台的副本会把它带回来，
  // 而记录本身还要继续挡住旧副本里的那条提示词。和别的删除记录一样 30 天后过期。
  hidden?: boolean;
};

export type SyncRecord = {
  id: string;
  action: 'auto' | 'manual' | 'login';
  status: 'success' | 'error';
  message: string;
  createdAt: string;
};

export type ViewKey = 'all' | 'favorites' | 'recent' | 'trash' | `category:${string}` | `subcategory:${string}`;

export type DisplayMode = 'collection' | 'single';

export type PromptDraft = {
  title: string;
  description: string;
  content: string;
  category: string;
  subcategory: string;
  tags: string;
  favorite: boolean;
};
