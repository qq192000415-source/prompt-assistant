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
