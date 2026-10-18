import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Menu } from 'lucide-react';
import { Button } from './components/ui/button';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { applyTheme, readTheme, type ThemeMode } from './lib/theme';
import { toast as pushToast } from 'sonner';
import type { CloudSnapshot } from './cloudSync';
import {
  DOCUMENT_CATEGORY_STORAGE_KEY,
  DOCUMENT_SUBCATEGORY_STORAGE_KEY,
  type FileFormat,
  getFormatFromFileName,
  loadCategories,
  loadPrompts,
  loadSubcategories,
  parseImportedByFormat,
  saveCategories,
  savePrompts,
  saveSubcategories,
  serializePromptsAsCsv,
  serializePromptsAsText,
} from './promptStorage';
import {
  appendPromptsToCategoryEnd,
  cleanCloudSnapshotRecords,
  cleanSyncRecords,
  createDeletedRecord,
  dedupePrompts,
  deriveCategories,
  deriveSubcategoryMap,
  type ExportSettings,
  findDuplicatePrompt,
  getPromptDuplicateKey,
  isDocumentItem,
  normalizeExportSettings,
  uniqueCategories,
  uniqueSubcategories,
} from './librarySync';
import {
  clampSidebarWidth,
  clearRememberedCloudLogin,
  type LibraryMode,
  loadDeletedRecords,
  loadExportSettings,
  loadLibraryMode,
  loadSidebarWidth,
  loadSyncRecords,
  saveDeletedRecords,
  saveExportSettings,
  saveLibraryMode,
  saveRememberedCloudLogin,
  saveSidebarWidth,
  saveSyncRecords,
} from './localState';
import { type LibrarySnapshot, useCloudSync } from './useCloudSync';
import { defaultDesktopSettings, normalizeDesktopSettings } from './desktopSettings';
import {
  copyToClipboard,
  createId,
  filterPrompts,
  getViewLabel,
  isTextDocument,
  parseSubcategoryView,
  parseTags,
  SEARCHABLE_TEXT_LIMIT,
} from './promptUtils';
import type { DeletedPromptRecord, DisplayMode, PromptDraft, PromptItem, SyncRecord, ViewKey } from './types';
import { APP_VERSION } from './appMeta';
import { DeletedRecordsView } from './components/DeletedRecordsView';
import {
  CategoryCreatorDialog,
  CloseRequestDialog,
  CloudAuthPanel,
  ConfirmDialog,
  type ConfirmDialogState,
} from './components/Dialogs';
import { DocumentView } from './components/DocumentView';
import { PromptEditor } from './components/PromptEditor';
import { PromptList } from './components/PromptList';
import { PromptDetail } from './components/PromptView';
import { SettingsPanel } from './components/SettingsPanel';
import { type MoveDirection, Sidebar } from './components/Sidebar';
import { TopMenuBar } from './components/TopMenuBar';
import { MaterialLibraryView } from './components/materials/MaterialLibraryView';

const emptyDraft: PromptDraft = {
  title: '',
  description: '',
  content: '',
  category: '写作',
  subcategory: '',
  tags: '',
  favorite: false,
};

type BrowserSavePickerOptions = {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
};

type BrowserFileWritable = {
  write: (data: Blob | string) => Promise<void>;
  close: () => Promise<void>;
};

type BrowserFileHandle = {
  createWritable: () => Promise<BrowserFileWritable>;
};

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options?: BrowserSavePickerOptions) => Promise<BrowserFileHandle>;
};

const defaultUpdateStatus: DesktopUpdateStatus = {
  status: 'idle',
  currentVersion: APP_VERSION,
  message: '尚未检查更新',
};

const FILE_FORMAT_LABELS: Record<FileFormat, string> = {
  json: 'JSON',
  txt: '记事本',
  csv: '表格',
};

const draftFromPrompt = (prompt: PromptItem): PromptDraft => ({
  title: prompt.title,
  description: prompt.description ?? '',
  content: prompt.content,
  category: prompt.category,
  subcategory: prompt.subcategory ?? '',
  tags: prompt.tags.join('，'),
  favorite: prompt.favorite,
});

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

function App() {
  const [allItems, setAllItems] = useState<PromptItem[]>(() => dedupePrompts(loadPrompts()));
  const [libraryMode, setLibraryMode] = useState<LibraryMode>(loadLibraryMode);
  const isDocumentMode = libraryMode === 'documents';
  // 素材库和创作画布共用素材库视图（画布生成的图存进素材库，参考图也从素材库来）。
  const isMaterialsMode = libraryMode === 'materials' || libraryMode === 'canvas';
  const [deletedRecords, setDeletedRecords] = useState<DeletedPromptRecord[]>(() => loadDeletedRecords());
  const [syncRecords, setSyncRecords] = useState<SyncRecord[]>(() => loadSyncRecords());
  const [promptCategories, setPromptCategories] = useState<string[]>(() => loadCategories());
  const [promptSubcategories, setPromptSubcategories] = useState<Record<string, string[]>>(() => loadSubcategories());
  const [documentCategories, setDocumentCategories] = useState<string[]>(() => loadCategories(DOCUMENT_CATEGORY_STORAGE_KEY, []));
  const [documentSubcategories, setDocumentSubcategories] = useState<Record<string, string[]>>(() =>
    loadSubcategories(DOCUMENT_SUBCATEGORY_STORAGE_KEY),
  );
  // 提示词和文档共用一套界面和处理函数：prompts / setPrompts / 分类状态都指向当前库，
  // 另一个库的条目原样保留。
  const prompts = useMemo(() => allItems.filter((item) => isDocumentItem(item) === isDocumentMode), [allItems, isDocumentMode]);
  const setPrompts = (update: (items: PromptItem[]) => PromptItem[]) =>
    setAllItems((items) => [
      ...update(items.filter((item) => isDocumentItem(item) === isDocumentMode)),
      ...items.filter((item) => isDocumentItem(item) !== isDocumentMode),
    ]);
  const storedCategories = isDocumentMode ? documentCategories : promptCategories;
  const setStoredCategories = isDocumentMode ? setDocumentCategories : setPromptCategories;
  const setStoredSubcategories = isDocumentMode ? setDocumentSubcategories : setPromptSubcategories;
  const [activeView, setActiveView] = useState<ViewKey>('all');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('collection');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'detail'>('list');
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [editorPrompt, setEditorPrompt] = useState<PromptItem | null>(null);
  const [editorInitialCategory, setEditorInitialCategory] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isCategoryCreatorOpen, setIsCategoryCreatorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<FileFormat>('json');
  const [exportFormat, setExportFormat] = useState<FileFormat>('json');
  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => loadExportSettings());
  const [desktopSettings, setDesktopSettings] = useState<DesktopRuntimeSettings>(defaultDesktopSettings);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus>(defaultUpdateStatus);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsAboutInitiallyOpen, setSettingsAboutInitiallyOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [closeRequestOpen, setCloseRequestOpen] = useState(false);
  const [rememberCloseChoice, setRememberCloseChoice] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showToast = (message: string) => {
    pushToast(message);
  };

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const openSettingsPanel = (options?: { about?: boolean }) => {
    setSettingsAboutInitiallyOpen(Boolean(options?.about));
    setIsSettingsOpen(true);

    const desktopApi = window.promptAssistantDesktop;
    if (!desktopApi) return;

    void desktopApi
      .getSettings()
      .then((settings) => setDesktopSettings(normalizeDesktopSettings(settings, desktopSettings)))
      .catch(() => undefined);
  };

  useEffect(() => {
    savePrompts(allItems);
  }, [allItems]);

  useEffect(() => {
    saveLibraryMode(libraryMode);
  }, [libraryMode]);

  useEffect(() => {
    saveDeletedRecords(deletedRecords);
  }, [deletedRecords]);

  useEffect(() => {
    saveSyncRecords(syncRecords);
  }, [syncRecords]);

  useEffect(() => {
    saveCategories(promptCategories);
  }, [promptCategories]);

  useEffect(() => {
    saveSubcategories(promptSubcategories);
  }, [promptSubcategories]);

  useEffect(() => {
    saveCategories(documentCategories, DOCUMENT_CATEGORY_STORAGE_KEY);
  }, [documentCategories]);

  useEffect(() => {
    saveSubcategories(documentSubcategories, DOCUMENT_SUBCATEGORY_STORAGE_KEY);
  }, [documentSubcategories]);

  useEffect(() => {
    saveSidebarWidth(sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    saveExportSettings(exportSettings);
  }, [exportSettings]);

  useEffect(() => {
    const desktopApi = window.promptAssistantDesktop;
    if (!desktopApi) return;

    return desktopApi.onCloseRequest(() => {
      setRememberCloseChoice(false);
      setCloseRequestOpen(true);
    });
  }, []);

  useEffect(() => {
    const desktopApi = window.promptAssistantDesktop;
    if (!desktopApi?.getUpdateStatus) return;

    let canceled = false;
    void desktopApi
      .getUpdateStatus()
      .then((status) => {
        if (!canceled) {
          setUpdateStatus(status);
        }
      })
      .catch(() => undefined);

    const unsubscribe = desktopApi.onUpdateStatus?.((status) => {
      setUpdateStatus(status);
      if (status.status === 'available' || status.status === 'downloaded' || status.status === 'error') {
        showToast(status.message);
      }
    });

    return () => {
      canceled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const desktopApi = window.promptAssistantDesktop;
    if (!desktopApi) return;

    let canceled = false;
    void desktopApi
      .getSettings()
      .then((settings) => {
        if (!canceled) {
          setDesktopSettings(normalizeDesktopSettings(settings));
        }
      })
      .catch(() => undefined);

    return () => {
      canceled = true;
    };
  }, []);

  const categories = useMemo(() => deriveCategories(storedCategories, prompts), [storedCategories, prompts]);

  const visiblePrompts = useMemo(() => filterPrompts(prompts, activeView, query), [prompts, activeView, query]);
  // 搜索在当前库里进行；另一个库也有匹配时给出提示，一键切过去看。
  const otherLibraryMatchCount = useMemo(
    () =>
      query.trim()
        ? filterPrompts(
            allItems.filter((item) => isDocumentItem(item) !== isDocumentMode),
            'all',
            query,
          ).length
        : 0,
    [allItems, isDocumentMode, query],
  );
  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedId) ?? null;

  const addSyncRecord = (record: SyncRecord) => {
    setSyncRecords((records) => cleanSyncRecords([record, ...records]));
  };

  const markLibraryChanged = () => {
    const timestamp = new Date().toISOString();
    setExportSettings((settings) => ({ ...settings, libraryUpdatedAt: timestamp }));
    return timestamp;
  };

  const markDeletedRecordsChanged = () => {
    const timestamp = new Date().toISOString();
    setExportSettings((settings) => ({
      ...settings,
      libraryUpdatedAt: timestamp,
      deletedRecordsUpdatedAt: timestamp,
    }));
    return timestamp;
  };

  const markSyncRecordsChanged = () => {
    const timestamp = new Date().toISOString();
    setExportSettings((settings) => ({ ...settings, syncRecordsUpdatedAt: timestamp }));
    return timestamp;
  };

  const applySnapshot = (snapshot: CloudSnapshot) => {
    const cleanSnapshot = cleanCloudSnapshotRecords(snapshot);
    setAllItems(cleanSnapshot.prompts);
    setPromptCategories(cleanSnapshot.categories);
    setPromptSubcategories(cleanSnapshot.subcategories);
    setDocumentCategories(cleanSnapshot.documentCategories);
    setDocumentSubcategories(cleanSnapshot.documentSubcategories);
    setDeletedRecords(cleanSnapshot.deletedRecords);
    setSyncRecords(cleanSnapshot.syncRecords);
    setExportSettings(normalizeExportSettings(cleanSnapshot.exportSettings, exportSettings));
    setSelectedId((currentId) =>
      cleanSnapshot.prompts.some((prompt) => prompt.id === currentId) ? currentId : cleanSnapshot.prompts[0]?.id ?? null,
    );
  };

  const library = useMemo<LibrarySnapshot>(() => {
    const promptItems = allItems.filter((item) => !isDocumentItem(item));
    const documentItems = allItems.filter(isDocumentItem);
    return {
      prompts: dedupePrompts(allItems),
      categories: deriveCategories(promptCategories, promptItems),
      subcategories: deriveSubcategoryMap(promptSubcategories, promptItems),
      documentCategories: deriveCategories(documentCategories, documentItems),
      documentSubcategories: deriveSubcategoryMap(documentSubcategories, documentItems),
      deletedRecords,
      exportSettings,
    };
  }, [allItems, deletedRecords, documentCategories, documentSubcategories, exportSettings, promptCategories, promptSubcategories]);

  const cloud = useCloudSync({ library, syncRecords, applySnapshot, addSyncRecord, notify: showToast });

  useEffect(() => {
    if (mode !== 'list') return;

    if (!visiblePrompts.length) {
      if (selectedId) setSelectedId(null);
      return;
    }

    if (!selectedId || !visiblePrompts.some((prompt) => prompt.id === selectedId)) {
      setSelectedId(visiblePrompts[0].id);
    }
  }, [mode, selectedId, visiblePrompts]);

  const askConfirm = (dialog: ConfirmDialogState) => {
    setConfirmDialog(dialog);
  };

  const closeConfirmDialog = () => {
    setConfirmDialog(null);
  };

  const confirmCurrentDialog = () => {
    const action = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    action?.();
  };

  const performDesktopClose = (action: 'quit' | 'tray') => {
    const desktopApi = window.promptAssistantDesktop;
    setCloseRequestOpen(false);

    if (!desktopApi) return;

    void desktopApi
      .performClose({ action, remember: rememberCloseChoice })
      .then(() => {
        if (rememberCloseChoice) {
          setDesktopSettings((settings) => normalizeDesktopSettings({ ...settings, closeBehavior: action }, settings));
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '关闭窗口失败';
        showToast(message);
      });
  };

  const runDesktopUpdateAction = async (
    action: 'checkForUpdates' | 'downloadUpdate' | 'installUpdate',
    fallbackMessage: string,
  ) => {
    const desktopApi = window.promptAssistantDesktop;
    const updateAction = desktopApi?.[action];
    if (!updateAction) {
      showToast('请使用桌面安装版检查更新');
      setUpdateStatus({
        ...defaultUpdateStatus,
        status: 'unsupported',
        message: '请使用桌面安装版检查更新',
      });
      return;
    }

    try {
      const status = await updateAction();
      setUpdateStatus(status);
      if (status.status !== 'checking' && status.status !== 'downloading') {
        showToast(status.message || fallbackMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackMessage;
      setUpdateStatus((current) => ({ ...current, status: 'error', message }));
      showToast(message);
    }
  };

  const changeLibraryMode = (nextMode: LibraryMode) => {
    setLibraryMode(nextMode);
    setActiveView('all');
    setDisplayMode('collection');
    setMode('list');
    setSelectedId(null);
  };

  const changeView = (view: ViewKey) => {
    setActiveView(view);
    setDisplayMode('collection');
    setMode('list');
    setSelectedId(null);
    setSidebarOpen(false);
  };

  const selectPromptFromSidebar = (prompt: PromptItem) => {
    setActiveView(`category:${prompt.category}`);
    setSelectedId(prompt.id);
    setDisplayMode('single');
    setMode('list');
    setSidebarOpen(false);
  };

  const startSidebarResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    document.body.classList.add('resizing-sidebar');

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      document.body.classList.remove('resizing-sidebar');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const openCategoryCreator = () => {
    setIsCategoryCreatorOpen(true);
  };

  const createCategory = (rawName: string) => {
    const name = rawName.trim();
    if (!name) return false;
    if (categories.includes(name)) {
      showToast('这个分类已经存在');
      return false;
    }

    markLibraryChanged();
    setStoredCategories((items) => uniqueCategories([...items, name]));
    setActiveView(`category:${name}`);
    setDisplayMode('collection');
    setSelectedId(null);
    setMode('list');
    setSidebarOpen(false);
    showToast('分类已创建');
    return true;
  };

  const renameCategory = (oldName: string, nextName: string) => {
    const normalizedName = nextName.trim();
    if (!normalizedName || normalizedName === oldName) return true;

    if (categories.includes(normalizedName)) {
      showToast('这个分类已经存在');
      return false;
    }

    const now = new Date().toISOString();
    markLibraryChanged();
    setStoredCategories((items) => {
      const index = items.indexOf(oldName);
      if (index === -1) {
        return uniqueCategories([...items.filter((item) => item !== oldName), normalizedName]);
      }

      const updated = [...items];
      updated[index] = normalizedName;
      return uniqueCategories(updated);
    });
    setPrompts((items) =>
      items.map((item) => (item.category === oldName ? { ...item, category: normalizedName, updatedAt: now } : item)),
    );
    setStoredSubcategories((items) => {
      const updated = { ...items };
      const subcategories = updated[oldName];
      delete updated[oldName];
      updated[normalizedName] = uniqueSubcategories([...(updated[normalizedName] ?? []), ...(subcategories ?? [])]);
      return updated;
    });
    if (activeView === `category:${oldName}`) {
      setActiveView(`category:${normalizedName}`);
    }
    showToast('分类已重命名');
    return true;
  };

  const deleteCategory = (category: string) => {
    const deletedPrompts = prompts.filter((prompt) => prompt.category === category);
    const promptCount = deletedPrompts.length;
    const message = promptCount
      ? `确认删除“${category}”？下面 ${promptCount} 条子文件和提示词内容会一起删除。`
      : `确认删除“${category}”？`;

    askConfirm({
      title: '删除主文件夹',
      message,
      confirmLabel: '确认删除',
      onConfirm: () => {
        markDeletedRecordsChanged();
        if (deletedPrompts.length) {
          setDeletedRecords((records) => [
            ...deletedPrompts.map((prompt) => createDeletedRecord(prompt, 'category', category)),
            ...records,
          ]);
        }
        setStoredCategories((items) => uniqueCategories(items.filter((item) => item !== category)));
        setStoredSubcategories((items) => {
          const updated = { ...items };
          delete updated[category];
          return updated;
        });
        setPrompts((items) => items.filter((item) => item.category !== category));
        if (activeView === `category:${category}`) {
          setActiveView('all');
        }
        if (selectedPrompt?.category === category) {
          setSelectedId(null);
          setMode('list');
        }
        showToast(promptCount ? '主文件夹和提示词已删除' : '分类已删除');
      },
    });
  };

  const openNewEditor = () => {
    setEditorPrompt(null);
    setEditorInitialCategory(null);
    setIsEditorOpen(true);
  };

  const openNewEditorInCategory = (category: string) => {
    setEditorPrompt(null);
    setEditorInitialCategory(category);
    setIsEditorOpen(true);
  };

  const openEditEditor = (prompt: PromptItem) => {
    setEditorPrompt(prompt);
    setIsEditorOpen(true);
  };

  const duplicatePrompt = (prompt: PromptItem) => {
    const now = new Date().toISOString();
    const clone: PromptItem = {
      ...prompt,
      id: createId(),
      title: `${prompt.title}（副本）`,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: undefined,
    };

    markLibraryChanged();
    setPrompts((items) => appendPromptsToCategoryEnd(items, [clone]));
    setSelectedId(clone.id);
    setMode('list');
    showToast('已创建副本');
  };

  const upsertPrompt = (draft: PromptDraft) => {
    const now = new Date().toISOString();
    const normalizedTags = parseTags(draft.tags);
    const title = draft.title.trim();
    const description = draft.description.trim();
    const content = draft.content.trim();
    const category = draft.category.trim() || '其他';
    const subcategory = draft.subcategory.trim() || undefined;
    const duplicateCandidate = {
      title,
      content,
      category,
      subcategory,
    };
    const duplicatePrompt = findDuplicatePrompt(prompts, duplicateCandidate, editorPrompt?.id);

    if (duplicatePrompt) {
      setSelectedId(duplicatePrompt.id);
      setMode('list');
      showToast(editorPrompt ? '已存在相同提示词，未重复保存' : '已存在相同提示词，未重复创建');
      return;
    }

    markLibraryChanged();
    if (subcategory) {
      setStoredSubcategories((items) => ({
        ...items,
        [category]: uniqueSubcategories([...(items[category] ?? []), subcategory]),
      }));
    }

    if (editorPrompt) {
      const updatedPrompt: PromptItem = {
        ...editorPrompt,
        title,
        description,
        content,
        category,
        subcategory,
        tags: normalizedTags,
        favorite: draft.favorite,
        updatedAt: now,
      };

      setPrompts((items) => dedupePrompts(items.map((item) => (item.id === editorPrompt.id ? updatedPrompt : item))));
      setSelectedId(updatedPrompt.id);
      setMode('list');
      showToast('提示词已更新');
      return;
    }

    const newPrompt: PromptItem = {
      id: createId(),
      title,
      description,
      content,
      category,
      subcategory,
      tags: normalizedTags,
      favorite: draft.favorite,
      createdAt: now,
      updatedAt: now,
    };

    setPrompts((items) => appendPromptsToCategoryEnd(items, [newPrompt]));
    setSelectedId(newPrompt.id);
    setMode('list');
    showToast('提示词已创建');
  };

  const deletePrompt = (id: string) => {
    const target = prompts.find((prompt) => prompt.id === id);
    if (!target) return;

    askConfirm({
      title: '删除子文件',
      message: `确认删除“${target.title}”？这个子文件和提示词内容会一起删除。`,
      confirmLabel: '确认删除',
      onConfirm: () => {
        markDeletedRecordsChanged();
        setDeletedRecords((records) => [createDeletedRecord(target, 'prompt', target.title), ...records]);
        setPrompts((items) => items.filter((item) => item.id !== id));
        setSelectedId(null);
        setMode('list');
        showToast('提示词已删除');
      },
    });
  };

  const restoreDeletedRecord = (recordId: string) => {
    const record = deletedRecords.find((item) => item.id === recordId);
    if (!record) return;

    const existingIds = new Set(allItems.map((prompt) => prompt.id));
    const idExists = existingIds.has(record.prompt.id);
    const restoreIntoDocuments = isDocumentItem(record.prompt);
    const restoredPrompt: PromptItem = {
      ...record.prompt,
      id: idExists ? createId() : record.prompt.id,
      title: idExists ? `${record.prompt.title}（恢复）` : record.prompt.title,
      updatedAt: new Date().toISOString(),
    };

    (restoreIntoDocuments ? setDocumentCategories : setPromptCategories)((items) =>
      uniqueCategories([...items, restoredPrompt.category]),
    );
    if (restoredPrompt.subcategory) {
      (restoreIntoDocuments ? setDocumentSubcategories : setPromptSubcategories)((items) => ({
        ...items,
        [restoredPrompt.category]: uniqueSubcategories([
          ...(items[restoredPrompt.category] ?? []),
          restoredPrompt.subcategory ?? '',
        ]),
      }));
    }
    markDeletedRecordsChanged();
    setPrompts((items) => appendPromptsToCategoryEnd(items, [restoredPrompt]));
    setDeletedRecords((items) => items.filter((item) => item.id !== recordId));
    setLibraryMode(restoreIntoDocuments ? 'documents' : 'prompts');
    setActiveView(`category:${restoredPrompt.category}`);
    setDisplayMode('single');
    setMode('list');
    setSelectedId(restoredPrompt.id);
    showToast('提示词已恢复');
  };

  const removeDeletedRecord = (recordId: string) => {
    const record = deletedRecords.find((item) => item.id === recordId);
    if (!record) return;

    askConfirm({
      title: '移除删除记录',
      message: `确认从删除记录里移除“${record.prompt.title}”？移除后不能恢复。`,
      confirmLabel: '确认移除',
      onConfirm: () => {
        markDeletedRecordsChanged();
        setDeletedRecords((items) => items.filter((item) => item.id !== recordId));
        showToast('删除记录已移除');
      },
    });
  };

  const clearDeletedRecords = () => {
    if (!deletedRecords.length) {
      showToast('暂无删除记录');
      return;
    }

    askConfirm({
      title: '清空删除记录',
      message: `确认清空全部 ${deletedRecords.length} 条删除记录？清空后不能恢复。`,
      confirmLabel: '清空全部',
      onConfirm: () => {
        markDeletedRecordsChanged();
        setDeletedRecords([]);
        showToast('删除记录已清空');
      },
    });
  };

  const renamePrompt = (id: string, nextTitle: string) => {
    const normalizedTitle = nextTitle.trim();
    if (!normalizedTitle) {
      showToast('子文件名称不能为空');
      return false;
    }

    markLibraryChanged();
    setPrompts((items) =>
      items.map((item) => (item.id === id ? { ...item, title: normalizedTitle, updatedAt: new Date().toISOString() } : item)),
    );
    showToast('子文件已重命名');
    return true;
  };

  const moveCategory = (category: string, direction: MoveDirection) => {
    const currentIndex = categories.indexOf(category);
    const nextIndex = currentIndex + direction;
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= categories.length) return;

    const updated = [...categories];
    [updated[currentIndex], updated[nextIndex]] = [updated[nextIndex], updated[currentIndex]];
    markLibraryChanged();
    setStoredCategories(uniqueCategories(updated));
    showToast('主文件夹顺序已更新');
  };

  const movePrompt = (id: string, direction: MoveDirection) => {
    const target = prompts.find((prompt) => prompt.id === id);
    if (!target) return;

    const siblings = prompts.filter((prompt) => prompt.category === target.category);
    const currentSiblingIndex = siblings.findIndex((prompt) => prompt.id === id);
    const nextSibling = siblings[currentSiblingIndex + direction];
    if (!nextSibling) return;

    setPrompts((items) => {
      const currentIndex = items.findIndex((prompt) => prompt.id === id);
      const nextIndex = items.findIndex((prompt) => prompt.id === nextSibling.id);
      if (currentIndex === -1 || nextIndex === -1) return items;

      const updated = [...items];
      [updated[currentIndex], updated[nextIndex]] = [updated[nextIndex], updated[currentIndex]];
      return updated;
    });
    markLibraryChanged();
    showToast('子文件顺序已更新');
  };

  const toggleFavorite = (id: string) => {
    markLibraryChanged();
    setPrompts((items) =>
      items.map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite, updatedAt: new Date().toISOString() } : item,
      ),
    );
  };

  const updatePromptContent = (id: string, content: string) => {
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      showToast('提示词正文不能为空');
      return false;
    }

    markLibraryChanged();
    setPrompts((items) =>
      items.map((item) =>
        item.id === id ? { ...item, content: normalizedContent, updatedAt: new Date().toISOString() } : item,
      ),
    );
    showToast('正文已保存');
    return true;
  };

  // 文档的配套指令存在 description 里：发文件给 AI 时，配合这段指令一起用。
  const updateDocumentInstruction = (id: string, instruction: string) => {
    markLibraryChanged();
    setPrompts((items) =>
      items.map((item) =>
        item.id === id ? { ...item, description: instruction.trim(), updatedAt: new Date().toISOString() } : item,
      ),
    );
    showToast(instruction.trim() ? '配套指令已保存' : '配套指令已清空');
  };

  const copyPrompt = async (id: string, content: string, message = '已复制到剪贴板') => {
    try {
      await copyToClipboard(content);
      const now = new Date().toISOString();
      markLibraryChanged();
      setPrompts((items) => items.map((item) => (item.id === id ? { ...item, lastUsedAt: now } : item)));
      showToast(message);
    } catch {
      showToast('复制失败，请手动选中文本复制');
    }
  };

  const documentsApi = window.promptAssistantDesktop?.documents;

  const addDocuments = async (category?: string) => {
    if (!documentsApi) {
      showToast('添加文档需要在桌面版里使用');
      return;
    }

    const { added, errors } = await documentsApi.pickAndAdd();
    errors.forEach((error) => showToast(`${error.name}：${error.message}`));
    if (!added.length) return;

    const activeSubcategoryView = parseSubcategoryView(activeView);
    const activeCategoryName = activeView.startsWith('category:') ? activeView.slice('category:'.length) : activeSubcategoryView?.category;
    const targetCategory = category ?? (isDocumentMode ? activeCategoryName : undefined) ?? '其他';
    const targetSubcategory = category || !isDocumentMode ? undefined : activeSubcategoryView?.subcategory;
    const existingKeys = new Set(allItems.filter(isDocumentItem).map(getPromptDuplicateKey));
    const now = new Date().toISOString();
    const fresh: PromptItem[] = [];

    for (const file of added) {
      const item: PromptItem = {
        id: createId(),
        kind: 'document',
        file,
        title: file.name.replace(/\.[^.]+$/, '') || file.name,
        description: '',
        content: isTextDocument(file.name) ? (await documentsApi.readText(file.sha256)).slice(0, SEARCHABLE_TEXT_LIMIT) : '',
        category: targetCategory,
        subcategory: targetSubcategory,
        tags: [],
        favorite: false,
        createdAt: now,
        updatedAt: now,
      };
      const key = getPromptDuplicateKey(item);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      fresh.push(item);
    }

    const skipped = added.length - fresh.length;
    if (!fresh.length) {
      showToast(`这些文件已经在“${targetCategory}”里了，跳过 ${skipped} 个`);
      return;
    }

    markLibraryChanged();
    setDocumentCategories((items) => uniqueCategories([...items, targetCategory]));
    setPrompts((items) => appendPromptsToCategoryEnd(items, fresh));
    setLibraryMode('documents');
    setSelectedId(fresh[0].id);
    setMode('list');
    showToast(skipped ? `已添加 ${fresh.length} 个文档，跳过 ${skipped} 个重复` : `已添加 ${fresh.length} 个文档`);
    void cloud.pushDocumentFiles(fresh.flatMap((item) => (item.file ? [item.file] : [])));
  };

  // 在软件里改文本文档：新内容按 sha256 另存一份，条目指向新文件，再补传到云端。
  const updateDocumentText = async (item: PromptItem, text: string) => {
    if (!documentsApi || !item.file) return false;

    try {
      const file = { ...item.file, ...(await documentsApi.saveText(text)) };
      markLibraryChanged();
      setPrompts((items) =>
        items.map((entry) =>
          entry.id === item.id
            ? { ...entry, file, content: text.slice(0, SEARCHABLE_TEXT_LIMIT), updatedAt: new Date().toISOString() }
            : entry,
        ),
      );
      showToast('文档已保存');
      void cloud.pushDocumentFiles([file]);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败');
      return false;
    }
  };

  const copyDocumentFile = async (item: PromptItem) => {
    if (!documentsApi || !item.file) return;

    try {
      await cloud.ensureDocumentLocal(item.file);
      await documentsApi.copyFile(item.file.sha256, item.file.name);
      const now = new Date().toISOString();
      markLibraryChanged();
      setPrompts((items) => items.map((entry) => (entry.id === item.id ? { ...entry, lastUsedAt: now } : entry)));
      showToast('文件已复制，到微信、QQ、邮件或文件夹里粘贴即可发送');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '复制文件失败');
    }
  };

  const exportPrompts = async (format: FileFormat) => {
    // ponytail: 文档不进导出文件，文件本体靠本机和云端保存；要整库备份再加打包导出。
    const prompts = allItems.filter((item) => !isDocumentItem(item));
    const payload =
      format === 'csv'
        ? { content: `\uFEFF${serializePromptsAsCsv(prompts)}`, extension: 'csv', mime: 'text/csv;charset=utf-8' }
        : format === 'txt'
          ? { content: `\uFEFF${serializePromptsAsText(prompts)}`, extension: 'txt', mime: 'text/plain;charset=utf-8' }
          : { content: JSON.stringify(prompts, null, 2), extension: 'json', mime: 'application/json' };

    const blob = new Blob([payload.content], { type: payload.mime });
    const fileName = `prompt-library-${new Date().toISOString().slice(0, 10)}.${payload.extension}`;

    if (exportSettings.mode === 'picker') {
      const pickerWindow = window as SavePickerWindow;

      if (pickerWindow.showSaveFilePicker) {
        try {
          const handle = await pickerWindow.showSaveFilePicker({
            suggestedName: fileName,
            types: [
              {
                description: FILE_FORMAT_LABELS[format],
                accept: { [payload.mime.split(';')[0]]: [`.${payload.extension}`] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast('已导出到选择的位置');
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            showToast('已取消导出');
            return;
          }

          showToast('选择路径失败，已改用默认下载');
        }
      } else {
        showToast('当前浏览器不支持选择位置，已改用默认下载');
      }
    }

    downloadBlob(blob, fileName);
    showToast(`已导出${FILE_FORMAT_LABELS[format]}文件`);
  };

  const importPrompts = async (file: File) => {
    try {
      const raw = await file.text();
      const format = getFormatFromFileName(file.name, importFormat);
      const imported = parseImportedByFormat(raw, format);
      const existingIds = new Set(prompts.map((prompt) => prompt.id));
      const existingKeys = new Set(prompts.map(getPromptDuplicateKey));
      const now = new Date().toISOString();
      const normalized: PromptItem[] = [];
      let skipped = 0;

      for (const prompt of imported) {
        let cleanPrompt: PromptItem = {
          ...prompt,
          title: prompt.title.trim(),
          description: prompt.description?.trim() ?? '',
          content: prompt.content.trim(),
          category: prompt.category.trim() || '其他',
          subcategory: prompt.subcategory?.trim() || undefined,
          tags: Array.isArray(prompt.tags) ? prompt.tags.map((tag) => tag.trim()).filter(Boolean) : [],
        };
        const duplicateKey = getPromptDuplicateKey(cleanPrompt);

        if (existingKeys.has(duplicateKey)) {
          skipped += 1;
          continue;
        }

        if (existingIds.has(cleanPrompt.id)) {
          cleanPrompt = {
            ...cleanPrompt,
            id: createId(),
            createdAt: now,
            updatedAt: now,
          };
        }

        existingIds.add(cleanPrompt.id);
        existingKeys.add(duplicateKey);
        normalized.push(cleanPrompt);
      }

      if (!normalized.length) {
        showToast(skipped ? `没有新增提示词，跳过 ${skipped} 条重复` : '没有可导入的提示词');
        return;
      }

      markLibraryChanged();
      setPrompts((items) => appendPromptsToCategoryEnd(items, normalized));
      setMode('list');
      showToast(
        skipped
          ? `已从${FILE_FORMAT_LABELS[format]}导入 ${normalized.length} 条，跳过 ${skipped} 条重复`
          : `已从${FILE_FORMAT_LABELS[format]}导入 ${normalized.length} 条提示词`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入失败');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const submitCloudAuth = async (mode: 'signin' | 'signup', email: string, password: string, remember: boolean) => {
    const message = await cloud.submitAuth(mode, email, password);
    if (remember) {
      saveRememberedCloudLogin(email, password);
    } else {
      clearRememberedCloudLogin();
    }
    setIsAuthOpen(false);
    showToast(message);
  };

  const manualCloudSync = async () => {
    if (!cloud.cloudEnabled) {
      showToast('请先在设置里配置云端');
      openSettingsPanel();
      return;
    }

    if (!cloud.isSignedIn) {
      showToast('请先登录云同步');
      setIsAuthOpen(true);
      return;
    }

    await cloud.manualSync();
  };

  const clearSyncRecords = async () => {
    const syncRecordsUpdatedAt = markSyncRecordsChanged();
    setSyncRecords([]);
    showToast('同步记录已清空，不会删除提示词');
    await cloud.saveClearedSyncRecords(syncRecordsUpdatedAt);
  };

  return (
    <TooltipProvider delayDuration={400}>
    <div className="app-shell">
      <Button className="mobile-menu" type="button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}>
        <Menu size={18} />
      </Button>

      <TopMenuBar
        activeView={activeView}
        deletedCount={deletedRecords.length}
        exportFormat={exportFormat}
        favoriteCount={prompts.filter((prompt) => prompt.favorite).length}
        importFormat={importFormat}
        promptCount={prompts.length}
        query={query}
        showSearch={!isMaterialsMode}
        searchLabel={isDocumentMode ? '文档' : '提示词'}
        recentCount={prompts.filter((prompt) => prompt.lastUsedAt).length}
        onChangeView={
          isMaterialsMode
            ? (view) => {
                changeLibraryMode('prompts');
                changeView(view);
              }
            : changeView
        }
        onExport={exportPrompts}
        onExportFormatChange={setExportFormat}
        onImport={() => fileInputRef.current?.click()}
        onAddDocuments={() => void addDocuments()}
        onImportFormatChange={setImportFormat}
        onOpenSettings={openSettingsPanel}
        setQuery={setQuery}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
      />

      {isMaterialsMode ? (
        <MaterialLibraryView libraryMode={libraryMode} onChangeLibraryMode={changeLibraryMode} notify={showToast} />
      ) : (
      <>
      <Sidebar
        activeView={activeView}
        categories={categories}
        cloudEmail={cloud.cloudEmail}
        cloudEnabled={cloud.cloudEnabled}
        cloudStatus={cloud.cloudStatus}
        onAddCategory={openCategoryCreator}
        onAddSubcategory={isDocumentMode ? (category) => void addDocuments(category) : openNewEditorInCategory}
        onChangeView={changeView}
        onClose={() => setSidebarOpen(false)}
        onCreatePrompt={isDocumentMode ? () => void addDocuments() : openNewEditor}
        libraryMode={libraryMode}
        onChangeLibraryMode={changeLibraryMode}
        onDeleteCategory={deleteCategory}
        onDeletePrompt={deletePrompt}
        onManualSync={manualCloudSync}
        onMoveCategory={moveCategory}
        onMovePrompt={movePrompt}
        onOpenAuth={() => setIsAuthOpen(true)}
        onRenameCategory={renameCategory}
        onRenamePrompt={renamePrompt}
        onSelectPrompt={selectPromptFromSidebar}
        onSignOut={cloud.signOut}
        onStartResize={startSidebarResize}
        isGlobalSearchActive={query.trim().length > 0}
        open={sidebarOpen}
        prompts={prompts}
        selectedId={selectedId}
        width={sidebarWidth}
      />

      <main className="workspace">
        {mode === 'detail' && (
          <header className="workspace-header compact-workspace-header">
            <div className="header-actions">
              <Button className="button ghost" type="button" onClick={() => setMode('list')}>
                <ArrowLeft size={16} />
                返回列表
              </Button>
            </div>
          </header>
        )}

        {otherLibraryMatchCount > 0 && activeView !== 'trash' && (
          <div className="library-search-hint">
            <span>
              {isDocumentMode ? '提示词' : '文档'}里还有 {otherLibraryMatchCount} 条匹配
            </span>
            <Button
              className="button ghost compact"
              type="button"
              onClick={() => changeLibraryMode(isDocumentMode ? 'prompts' : 'documents')}
            >
              去看看
            </Button>
          </div>
        )}

        {activeView === 'trash' ? (
          <DeletedRecordsView
            records={deletedRecords}
            onClearAll={clearDeletedRecords}
            onRemove={removeDeletedRecord}
            onRestore={restoreDeletedRecord}
          />
        ) : mode === 'detail' && selectedPrompt && isDocumentItem(selectedPrompt) ? (
          <DocumentView
            item={selectedPrompt}
            onCopyFile={copyDocumentFile}
            onCopyText={copyPrompt}
            onDelete={deletePrompt}
            onEnsureLocal={cloud.ensureDocumentLocal}
            onSaveInstruction={updateDocumentInstruction}
            onSaveText={updateDocumentText}
            onToggleFavorite={toggleFavorite}
          />
        ) : mode === 'detail' && selectedPrompt ? (
          <PromptDetail
            prompt={selectedPrompt}
            onCopy={copyPrompt}
            onDelete={deletePrompt}
            onDuplicate={duplicatePrompt}
            onEdit={openEditEditor}
            onToggleFavorite={toggleFavorite}
          />
        ) : (
          <PromptList
            activeLabel={isDocumentMode && activeView === 'all' ? '全部文档' : getViewLabel(activeView)}
            displayMode={displayMode}
            prompts={visiblePrompts}
            query={query}
            selectedPrompt={selectedPrompt}
            total={prompts.length}
            libraryMode={libraryMode}
            renderDocument={(item) => (
              <DocumentView
                key={item.id}
                item={item}
                onCopyFile={copyDocumentFile}
                onCopyText={copyPrompt}
                onDelete={deletePrompt}
                onEnsureLocal={cloud.ensureDocumentLocal}
                onSaveInstruction={updateDocumentInstruction}
                onSaveText={updateDocumentText}
                onToggleFavorite={toggleFavorite}
              />
            )}
            onNew={isDocumentMode ? () => void addDocuments() : openNewEditor}
            onCopy={copyPrompt}
            onDelete={deletePrompt}
            onDuplicate={duplicatePrompt}
            onToggleFavorite={toggleFavorite}
            onUpdateContent={updatePromptContent}
          />
        )}
      </main>
      </>
      )}

      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept=".json,.txt,.csv,application/json,text/plain,text/csv"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importPrompts(file);
        }}
      />

      {isCategoryCreatorOpen && (
        <CategoryCreatorDialog
          categories={categories}
          onClose={() => setIsCategoryCreatorOpen(false)}
          onCreate={(name) => {
            const created = createCategory(name);
            if (created) {
              setIsCategoryCreatorOpen(false);
            }
            return created;
          }}
        />
      )}

      {isEditorOpen && (
        <PromptEditor
          categories={categories}
          initialDraft={editorPrompt ? draftFromPrompt(editorPrompt) : { ...emptyDraft, category: editorInitialCategory ?? emptyDraft.category }}
          mode={editorPrompt ? 'edit' : 'new'}
          onClose={() => {
            setIsEditorOpen(false);
            setEditorInitialCategory(null);
          }}
          onSave={(draft) => {
            upsertPrompt(draft);
            setIsEditorOpen(false);
            setEditorInitialCategory(null);
          }}
        />
      )}

      {isSettingsOpen && (
        <SettingsPanel
          canManageCloud={cloud.canManageCloudSettings}
          cloudSettings={cloud.cloudSettings}
          desktopAvailable={Boolean(window.promptAssistantDesktop)}
          desktopSettings={desktopSettings}
          exportSettings={exportSettings}
          initialAboutOpen={settingsAboutInitiallyOpen}
          syncRecords={syncRecords}
          updateStatus={updateStatus}
          onClearSyncRecords={clearSyncRecords}
          onClose={() => {
            setIsSettingsOpen(false);
            setSettingsAboutInitiallyOpen(false);
          }}
          onCheckUpdate={() => runDesktopUpdateAction('checkForUpdates', '更新检查失败')}
          onDownloadUpdate={() => runDesktopUpdateAction('downloadUpdate', '更新下载失败')}
          onInstallUpdate={() => runDesktopUpdateAction('installUpdate', '更新安装失败')}
          theme={theme}
          onThemeChange={setTheme}
          onSave={(settings, nextCloudSettings, nextDesktopSettings) => {
            cloud.updateCloudSettings(nextCloudSettings);
            const normalizedExportSettings = normalizeExportSettings(settings, exportSettings);
            if (JSON.stringify(normalizedExportSettings) !== JSON.stringify(normalizeExportSettings(exportSettings))) {
              setExportSettings(normalizedExportSettings);
            }
            const normalizedDesktopSettings = normalizeDesktopSettings(nextDesktopSettings, desktopSettings);
            const desktopApi = window.promptAssistantDesktop;

            if (!desktopApi) {
              setDesktopSettings(normalizedDesktopSettings);
              setIsSettingsOpen(false);
              setSettingsAboutInitiallyOpen(false);
              showToast('设置已保存');
              return;
            }

            void desktopApi
              .updateSettings(normalizedDesktopSettings)
              .then((savedDesktopSettings) => {
                setDesktopSettings(normalizeDesktopSettings(savedDesktopSettings, normalizedDesktopSettings));
                setIsSettingsOpen(false);
                setSettingsAboutInitiallyOpen(false);
                showToast('设置已保存');
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : '桌面设置保存失败';
                showToast(message);
              });
          }}
        />
      )}

      {isAuthOpen && (
        <CloudAuthPanel
          cloudEnabled={cloud.cloudLoginEnabled}
          onClose={() => setIsAuthOpen(false)}
          onSubmit={submitCloudAuth}
        />
      )}

      {closeRequestOpen && (
        <CloseRequestDialog
          remember={rememberCloseChoice}
          onCancel={() => setCloseRequestOpen(false)}
          onRememberChange={setRememberCloseChoice}
          onTray={() => performDesktopClose('tray')}
          onQuit={() => performDesktopClose('quit')}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog dialog={confirmDialog} onCancel={closeConfirmDialog} onConfirm={confirmCurrentDialog} />
      )}

      <Toaster theme={theme} />
    </div>
    </TooltipProvider>
  );
}

export default App;
