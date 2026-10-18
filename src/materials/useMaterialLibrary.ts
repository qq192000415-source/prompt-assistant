import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMaterialsExportDir, saveMaterialsExportDir } from '../localState';
import { emptyLibrary, type MaterialLibrary, type MaterialMedia, type MaterialPatch } from './library';

export type MaterialStatus = 'unavailable' | 'loading' | 'unconfigured' | 'ready' | 'error';

// 主进程抛出的错误到渲染进程会带上 "Error invoking remote method 'x': Error: " 前缀，去掉只留原因。
const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');

const importSummary = (result: MaterialImportResult) => {
  const parts = [`导入 ${result.added} 个`];
  if (result.skipped) parts.push(`${result.skipped} 个已在库里，跳过`);
  if (result.errors.length) parts.push(`${result.errors.length} 个失败：${result.errors.map((error) => `${error.name}（${error.message}）`).join('、')}`);
  return parts.join('，');
};

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

export function useMaterialLibrary(notify: (message: string) => void) {
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

  const reload = useCallback(async () => {
    if (!api) return;
    setStatus('loading');
    try {
      const nextConfig = await api.getConfig();
      setConfig(nextConfig);
      if (!nextConfig.baseUrl || !nextConfig.hasPassword) {
        setStatus('unconfigured');
        return;
      }
      apply(await api.load());
    } catch (loadError) {
      setError(messageOf(loadError));
      setStatus('error');
    }
  }, [api, apply]);

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
