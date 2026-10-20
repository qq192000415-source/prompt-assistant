import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMaterialsExportDir, saveMaterialsExportDir } from '../localState';
import { emptyLibrary, type MaterialLibrary, type MaterialMedia, type MaterialPatch } from './library';
import { canvas } from './canvasStore';
import { listNasGrants, normalizeCloudEmail, saveNasGrant } from '../cloudSync';

export type MaterialStatus = 'unavailable' | 'loading' | 'unconfigured' | 'signed-out' | 'ready' | 'error';
// 素材库按云同步账号分开存放；adoptLegacy 是管理员账号，第一次打开时把 NAS 根下的旧数据搬进自己的文件夹。
export type MaterialAccount = { email: string; adoptLegacy: boolean };

// 主进程抛出的错误到渲染进程会带上 "Error invoking remote method 'x': Error: " 前缀，去掉只留原因。
const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');

const importSummary = (result: MaterialImportResult) => {
  const parts = [`导入 ${result.added} 个`];
  if (result.skipped) parts.push(`${result.skipped} 个已在库里，跳过`);
  if (result.errors.length) parts.push(`${result.errors.length} 个失败：${result.errors.map((error) => `${error.name}（${error.message}）`).join('、')}`);
  return parts.join('，');
};

const SLOT_NAMES: Record<MaterialAiSlotName, string> = { text: '文本模型', vision: '视觉模型', image: '生图模型' };

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);
const failureText = (failures: MaterialBatchFailure[]) =>
  failures.length ? `，${failures.length} 个失败：${failures.map((failure) => `${failure.name}（${failure.message}）`).join('、')}` : '';

const compressSummary = (kind: string, result: MaterialCompressResult) =>
  [
    result.canceled ? `已取消，取消前压缩了 ${result.processed} 个${kind}` : `压缩了 ${result.processed} 个${kind}`,
    result.savedBytes > 0 ? `省下 ${formatBytes(result.savedBytes)}` : '',
    result.notSmaller ? `${result.notSmaller} 个压不小，保持原样` : '',
    result.skippedUnsupported ? `${result.skippedUnsupported} 个不是可压缩的${kind}，跳过` : '',
  ]
    .filter(Boolean)
    .join('，') + failureText(result.failures);

export function useMaterialLibrary(notify: (message: string) => void, account: MaterialAccount | null) {
  const api = window.promptAssistantDesktop?.materials;
  const [status, setStatus] = useState<MaterialStatus>(api ? 'loading' : 'unavailable');
  const [config, setConfig] = useState<NasConfig | null>(null);
  const [library, setLibrary] = useState<MaterialLibrary>(() => emptyLibrary());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<MaterialBatchProgress | null>(null);
  // 调用方每次渲染传进来的 notify 都可能是新函数，放进 ref，避免它变化时重新连 NAS。
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const apply = useCallback(
    (result: MaterialLoadResult) => {
      setLibrary(result.library);
      setStatus('ready');
      setError('');
      if (result.dropped) {
        notifyRef.current(`library.json 里有 ${result.dropped} 条记录读不懂，已跳过；下次保存时它们不会被保留`);
      }
    },
    [],
  );

  // quiet：NAS 重新连上后在后台重读，不切到「正在读取」，画布不会被卸掉重来。
  const reload = useCallback(async (quiet = false) => {
    if (!api) return;
    if (!quiet) setStatus('loading');
    try {
      const nextConfig = await api.getConfig();
      setConfig(nextConfig);
      if (!nextConfig.baseUrl || !nextConfig.hasPassword) {
        setStatus('unconfigured');
        return;
      }
      canvas.switchAccount(account?.email ?? '');
      if (!account) {
        await api.setAccount('', false);
        setStatus('signed-out');
        return;
      }
      const { moved } = await api.setAccount(account.email, account.adoptLegacy);
      if (moved.length) notifyRef.current(`已把以前放在 NAS 根目录的素材搬进你的账号文件夹：${moved.join('、')}`);
      apply(await api.load());
    } catch (loadError) {
      setError(messageOf(loadError));
      setStatus('error');
    }
  }, [api, apply, account?.email, account?.adoptLegacy]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => api?.onProgress(setProgress), [api]);

  // 批量任务：进度条等主进程发来第一条进度才出现（导出要先选完文件夹），结束后清掉。
  const runBatch = async <T,>(label: string, action: () => Promise<T>): Promise<T | null> => {
    try {
      return await run(label, action);
    } finally {
      setProgress(null);
    }
  };

  // 所有写操作走这里：显示进行中的文字，失败时把原因告诉用户，不吞掉。
  const run = async <T,>(label: string, action: () => Promise<T>): Promise<T | null> => {
    if (!api) return null;
    setBusy(label);
    try {
      return await action();
    } catch (actionError) {
      notify(messageOf(actionError));
      return null;
    } finally {
      setBusy('');
    }
  };

  const finishImport = (result: MaterialImportResult | null) => {
    if (!result) return;
    apply(result);
    notify(importSummary(result));
  };

  return {
    status,
    config,
    library,
    error,
    busy,
    reload,
    saveConfig: async (input: { baseUrl: string; username: string; password?: string }) => {
      if (!api) return false;
      const saved = await run('正在连接 NAS…', () => api.saveConfig(input));
      if (!saved) return false;
      setConfig(saved);
      notify('NAS 已连接');
      await reload();
      return true;
    },
    pickAndImport: async (category: string) => finishImport(await run('正在导入…', () => api!.pickAndImport(category))),
    importPaths: async (paths: string[], category: string) =>
      finishImport(await run(`正在导入 ${paths.length} 个文件…`, () => api!.importPaths(paths, category))),
    importClipboard: async (category: string) => finishImport(await run('正在导入剪贴板图片…', () => api!.importClipboard(category))),
    pathForFile: (file: File) => api?.pathForFile(file) ?? '',
    update: async (id: string, patch: MaterialPatch) => {
      const result = await run('正在保存…', () => api!.update(id, patch));
      if (result) apply(result);
      return Boolean(result);
    },
    remove: async (ids: string[]) => {
      const result = await run('正在删除…', () => api!.remove(ids));
      if (!result) return false;
      apply(result);
      notify(result.warnings.length ? `已删除，但有 ${result.warnings.length} 个文件没能从 NAS 上删掉：${result.warnings.join('；')}` : '已删除');
      return true;
    },
    copyImage: async (media: Pick<MaterialMedia, 'sha256' | 'ext'>) => {
      const done = await run('正在复制图片…', async () => {
        await api!.copyImage(media);
        return true;
      });
      if (done) notify('图片已复制');
    },
    progress,
    cancelBatch: () => void api?.cancelBatch(),
    ffmpegStatus: () => api!.ffmpegStatus(),
    installFfmpeg: async () => Boolean(await runBatch('下载 FFmpeg', async () => (await api!.installFfmpeg(), true))),
    compressImages: async (ids: string[], options: MaterialImageCompressOptions) => {
      const result = await runBatch('压缩图片', () => api!.compressImages(ids, options));
      if (!result) return false;
      apply(result);
      notify(compressSummary('图片', result));
      return true;
    },
    compressVideos: async (ids: string[], options: MaterialVideoCompressOptions) => {
      const result = await runBatch('压缩视频', () => api!.compressVideos(ids, options));
      if (!result) return false;
      apply(result);
      notify(compressSummary('视频', result));
      return true;
    },
    importWord: async (category: string) => finishImport(await runBatch('导入 Word', () => api!.importWord(category))),
    importShare: async () => finishImport(await runBatch('导入分享包', () => api!.importShare())),
    exportShare: async (ids: string[]) => {
      const result = await runBatch('导出分享包', () => api!.exportShare(ids, loadMaterialsExportDir()));
      if (!result) return false;
      saveMaterialsExportDir(result.dir.replace(/[\\/][^\\/]*$/, ''));
      notify(result.canceled ? '已取消导出分享包' : `分享包已导出：${result.dir}，包含 ${result.exported} 个文件${failureText(result.failures)}`);
      return true;
    },
    aiGetSettings: () => api!.aiGetSettings(),
    // 画布的模型下拉：用生图位置已保存的地址和 Key 查能生图的模型；切换只改模型名。
    aiListImageModels: async () => {
      const { image } = await api!.aiGetSettings();
      if (!image) return [];
      const models = await run('正在查询模型…', () => api!.aiListModels('image', { provider: image.provider, baseUrl: image.baseUrl, model: image.model, apiKey: '' }));
      return models ? models.filter((entry) => entry.generation).map((entry) => entry.id) : [];
    },
    aiSetImageModel: async (model: string) => {
      const saved = await run('正在切换模型…', () => api!.aiSetImageModel(model));
      if (saved?.image) notify(`生图模型换成了 ${saved.image.model}`);
      return saved?.image?.usable ? saved.image.model : null;
    },
    // 详情页的单条 AI：结果只回给调用方填进草稿，用户点保存才写入 NAS。
    aiReverse: (id: string) => run('AI 正在看图反推…', () => api!.aiReverse(id)),
    aiOptimize: (prompt: string, kind: 'positive' | 'negative') => run('AI 正在优化…', () => api!.aiOptimize(prompt, kind)),
    aiTranslate: (prompt: string, negativePrompt: string) => run('AI 正在翻译…', () => api!.aiTranslate(prompt, negativePrompt)),
    aiClassify: (id: string, prompt: string) => run('AI 正在分类打标签…', () => api!.aiClassify(id, prompt)),
    aiBatchReverse: async (ids: string[]) => {
      const result = await runBatch('AI 反推', () => api!.aiBatchReverse(ids));
      if (!result) return false;
      apply(result);
      notify(
        `${result.canceled ? '已取消，' : ''}反推了 ${result.processed} 组` +
          (result.skipped ? `，${result.skipped} 组已有提示词，跳过` : '') +
          failureText(result.failures),
      );
      return true;
    },
    aiBatchClassify: async (ids: string[]) => {
      const result = await runBatch('AI 分类打标签', () => api!.aiBatchClassify(ids));
      if (!result) return false;
      apply(result);
      notify(`${result.canceled ? '已取消，' : ''}给 ${result.processed} 组分类打了标签${failureText(result.failures)}`);
      return true;
    },
    // 提交生图不走 run：任务进队列后立刻返回，进行状态和失败原因由画布按队列显示，不锁整个素材库。
    canvasSubmit: (input: Parameters<DesktopMaterialsApi['canvasSubmit']>[0]) => api!.canvasSubmit(input),
    canvasQueue: () => api!.canvasQueue(),
    onCanvasQueue: (callback: (tasks: MaterialCanvasTask[]) => void) => api?.onCanvasQueue(callback) ?? (() => undefined),
    canvasCancel: (taskId: string) => api!.canvasCancel(taskId).catch((error) => notify(messageOf(error))),
    canvasRetry: (taskId: string, index: number) => api!.canvasRetry(taskId, index).catch((error) => notify(messageOf(error))),
    canvasDismiss: (taskId: string) => api!.canvasDismiss(taskId).catch((error) => notify(messageOf(error))),
    canvasHistory: () => api!.canvasHistory(),
    canvasHistoryDelete: async (ids: string[]) => {
      const result = await run('正在删除…', () => api!.canvasHistoryDelete(ids));
      if (!result) return null;
      notify(result.warnings.length ? `已删除，但有 ${result.warnings.length} 个文件没能从 NAS 上删掉：${result.warnings.join('；')}` : '已删除');
      return result.history;
    },
    // 读模板不走 run：没配 NAS 时由模板栏自己显示原因。改动走 run，出错统一提示；记使用次数失败不打扰。
    canvasTemplates: () => api!.canvasTemplates(),
    canvasTemplateSave: async (input: Parameters<DesktopMaterialsApi['canvasTemplateSave']>[0]) => {
      const saved = await run('正在保存模板…', () => api!.canvasTemplateSave(input));
      if (saved) notify(saved.result.duplicate ? '模板库里已经有这条了' : '已保存模板');
      return saved;
    },
    canvasTemplateDelete: async (id: string) => {
      const result = await run('正在删除模板…', () => api!.canvasTemplateDelete(id));
      if (result) notify('已删除模板');
      return result;
    },
    canvasTemplateUse: (id: string) => api!.canvasTemplateUse(id).catch((error) => (console.warn('记录模板使用次数失败', error), null)),
    canvasSave: async (taskId: string, index: number) => {
      const result = await run('正在存入素材库…', () => api!.canvasSave(taskId, index));
      if (!result) return false;
      apply(result);
      notify(result.added ? '已存入素材库' : '素材库里已有这张图');
      return true;
    },
    canvasSaveAs: async (taskId: string, index: number) => {
      const saved = await run('正在保存…', () => api!.canvasSaveAs(taskId, index));
      if (saved) notify(`已保存到 ${saved}`);
    },
    canvasCopyImage: async (taskId: string, index: number) => {
      const done = await run('正在复制图片…', async () => {
        await api!.canvasCopyImage(taskId, index);
        return true;
      });
      if (done) notify('图片已复制');
    },
    canvasReference: (id: string) => run('正在读取参考图…', () => api!.canvasReference(id)),
    canvasClipboardImage: () => run('正在读取剪贴板…', () => api!.canvasClipboardImage()),
    canvasHistoryImage: (media: { sha256: string; ext: string }) => run('正在读取图片…', () => api!.canvasHistoryImage(media.sha256, media.ext)),
    exportItems: async (ids: string[]) => {
      const result = await runBatch('导出', () => api!.exportItems(ids, loadMaterialsExportDir()));
      if (!result) return false;
      saveMaterialsExportDir(result.dir);
      notify(`${result.canceled ? '已取消，' : ''}导出了 ${result.exported} 个文件到 ${result.dir}${failureText(result.failures)}`);
      return true;
    },
  };
}

export type MaterialLibraryController = ReturnType<typeof useMaterialLibrary>;

// 设置页用：只管 NAS 连接、网络代理和 AI 设置，不读素材库。回到素材页时素材库视图会重新挂载、按新设置重读。
export function useMaterialSettings(notify: (message: string) => void, adminEmail: string | null = null) {
  const api = window.promptAssistantDesktop?.materials;
  const [config, setConfig] = useState<NasConfig | null>(null);
  const [busy, setBusy] = useState('');
  // 每次保存连接后加一，授权管理按它重新读列表（保存时可能更新了授权表）。
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    void api?.getConfig().then(setConfig, (error) => notify(messageOf(error)));
  }, [api]);

  const run = async <T,>(label: string, action: () => Promise<T>): Promise<T | null> => {
    setBusy(label);
    try {
      return await action();
    } catch (actionError) {
      notify(messageOf(actionError));
      return null;
    } finally {
      setBusy('');
    }
  };

  return {
    available: Boolean(api),
    config,
    savedCount,
    busy,
    saveConfig: async (input: { baseUrl: string; username: string; password?: string }) => {
      const saved = await run('正在连接 NAS…', () => api!.saveConfig(input));
      if (!saved) return false;
      setConfig(saved);
      notify('NAS 已连接');
      // 管理员改了连接：自己那一行（换电脑自动填）和已授权的账号一起换成新的。授权表没建好时只提示，不影响本机的连接。
      if (adminEmail) {
        try {
          const own = await api!.revealConfig();
          const targets = new Set([normalizeCloudEmail(adminEmail), ...(await listNasGrants()).map((entry) => entry.email)]);
          for (const email of targets) await saveNasGrant({ email, baseUrl: own.baseUrl, username: own.username, password: own.password });
        } catch (error) {
          notify(`NAS 已连接，但没能更新授权表：${messageOf(error)}`);
        }
      }
      setSavedCount((count) => count + 1);
      return true;
    },
    getProxy: () => api!.getProxy(),
    saveProxy: (settings: MaterialProxySettings) => run('正在测试网络…', () => api!.saveProxy(settings)),
    aiGetSettings: () => api!.aiGetSettings(),
    aiSaveSettings: async (settings: MaterialAiSettingsInput) => {
      const saved = await run('正在保存 API 配置…', () => api!.aiSaveSettings(settings));
      if (saved) notify('API 配置已保存');
      return saved;
    },
    aiListModels: (slot: MaterialAiSlotName, input: MaterialAiSlotInput) => run('正在查询模型…', () => api!.aiListModels(slot, input)),
    aiTest: async (slot: MaterialAiSlotName, input: MaterialAiSlotInput) => {
      const done = await run('正在测试连接…', async () => (await api!.aiTest(slot, input), true));
      if (done) notify(`${SLOT_NAMES[slot]}连接成功`);
    },
  };
}
