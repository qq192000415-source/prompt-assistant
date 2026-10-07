export type PromptItem = {
  id: string;
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
