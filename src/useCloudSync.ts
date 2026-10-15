import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudConflictError,
  downloadCloudFile,
  getCloudConfig,
  getCloudSettingsForEmail,
  getCloudSettingsForProvider,
  getCurrentCloudSession,
  hasConfiguredCloudEndpoint,
  isAdminCloudUser,
  listCloudFileShas,
  loadCloudSettings,
  loadCloudSnapshot,
  loadCloudUpdatedAt,
  saveCloudSettings,
  saveCloudSnapshot,
  signInToCloud,
  signOutFromCloud,
  signUpToCloud,
  subscribeToCloudAuth,
  uploadCloudFile,
  type CloudSession,
  type CloudSettings,
  type CloudSnapshot,
} from './cloudSync';
import {
  cleanCloudSnapshotRecords,
  createSyncRecord,
  mergeCloudSnapshot,
  normalizeExportSettings,
  reconcileWithCloud,
  stampSnapshot,
} from './librarySync';
import type { DocumentFile, SyncRecord } from './types';

// 云同步的时机和网络读写：登录后合并、改动后防抖自动保存、冲突时先合并再写、回到窗口时拉取、文档文件补传。
// 合并规则本身在 librarySync.ts；这里只决定什么时候做、结果交给 App。

// 不含 syncRecords：自动保存成功会追加一条同步记录，算进去就会无限触发保存。
export type LibrarySnapshot = Omit<CloudSnapshot, 'syncRecords' | 'updatedAt'>;

type UseCloudSyncOptions = {
  library: LibrarySnapshot;
  syncRecords: SyncRecord[];
  applySnapshot: (snapshot: CloudSnapshot) => void;
  addSyncRecord: (record: SyncRecord) => void;
  notify: (message: string) => void;
};

const AUTO_SAVE_DELAY_MS = 900;
const documentsApi = () => window.promptAssistantDesktop?.documents;
const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function useCloudSync({ library, syncRecords, applySnapshot, addSyncRecord, notify }: UseCloudSyncOptions) {
  const [cloudSettings, setCloudSettings] = useState<CloudSettings>(() => loadCloudSettings());
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const activeCloudSettings = useMemo(() => getCloudSettingsForProvider(cloudSettings.provider, cloudSettings), [cloudSettings]);
  const activeCloudConfig = useMemo(() => getCloudConfig(activeCloudSettings), [activeCloudSettings]);
  const cloudLoginEnabled = useMemo(() => hasConfiguredCloudEndpoint(cloudSettings), [cloudSettings]);
  const [cloudReadyUserId, setCloudReadyUserId] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState(getCloudConfig(loadCloudSettings()).enabled ? '未登录' : '未配置云端');
  const latestSnapshotRef = useRef<CloudSnapshot | null>(null);
  const cloudUpdatedAtRef = useRef<string | null>(null);
  const canManageCloudSettings = isAdminCloudUser(cloudSession?.user.email, cloudSettings);
  const userId = cloudSession?.user.id;
  const isCloudReady = Boolean(userId && cloudReadyUserId === userId);

  const reportError = (action: SyncRecord['action'], error: unknown, fallback: string) => {
    const message = errorMessage(error, fallback);
    addSyncRecord(createSyncRecord(action, 'error', message));
    notify(message);
  };

  // 其他设备改过云端时：拉取、合并到本机，再按新的 updated_at 写回。
  const mergeCloudIntoLocal = async (uid: string, settings: CloudSettings, action: SyncRecord['action'], message: string) => {
    const cloudSnapshot = await loadCloudSnapshot(uid, settings);
    const localSnapshot = latestSnapshotRef.current;
    if (!localSnapshot) return;
    const merged = cloudSnapshot ? mergeCloudSnapshot(localSnapshot, cloudSnapshot) : localSnapshot;
    const nextSnapshot = stampSnapshot(merged, createSyncRecord(action, 'success', message));
    applySnapshot(nextSnapshot);
    cloudUpdatedAtRef.current = await saveCloudSnapshot(uid, nextSnapshot, cloudSnapshot?.updatedAt ?? null, settings);
  };

  // 登录和手动同步共用：拉云端、合并、应用到本机、写回云端。
  const reconcileAndSave = async (uid: string, settings: CloudSettings, action: 'login' | 'manual', isCanceled = () => false) => {
    const localSnapshot = latestSnapshotRef.current ?? { ...library, syncRecords };
    const cloudSnapshot = await loadCloudSnapshot(uid, settings);
    const { snapshot, pullCloudOnly } = reconcileWithCloud(localSnapshot, cloudSnapshot);
    if (isCanceled()) return null;

    const message =
      action === 'manual'
        ? cloudSnapshot
          ? '手动同步完成，已合并云端数据'
          : '手动同步完成，已上传本地数据'
        : pullCloudOnly
          ? '已自动拉取云端数据'
          : cloudSnapshot
            ? '已合并云端数据'
            : '已把本地数据同步到云端';
    const nextSnapshot = stampSnapshot(snapshot, createSyncRecord(action, 'success', message));
    applySnapshot(nextSnapshot);
    cloudUpdatedAtRef.current = await saveCloudSnapshot(uid, nextSnapshot, cloudSnapshot?.updatedAt ?? null, settings);
    return message;
  };

  const pushDocumentFiles = async (files: DocumentFile[]) => {
    const api = documentsApi();
    if (!api || !userId || !isCloudReady || !files.length) return;

    try {
      const cloudShas = await listCloudFileShas(userId, activeCloudSettings);
      for (const sha of new Set(files.map((file) => file.sha256))) {
        if (cloudShas.has(sha) || !(await api.has(sha))) continue;
        await uploadCloudFile(userId, sha, await api.readBytes(sha), activeCloudSettings);
      }
    } catch (error) {
      reportError('auto', error, '上传文档到云端失败');
    }
  };

  const ensureDocumentLocal = async (file: DocumentFile) => {
    const api = documentsApi();
    if (!api) throw new Error('文档需要在桌面版里使用');
    if (await api.has(file.sha256)) return;

    if (!userId) throw new Error('本机没有这个文件，登录云同步后可以从云端取回');
    await api.writeBytes(file.sha256, await downloadCloudFile(userId, file.sha256, activeCloudSettings));
  };

  useEffect(() => {
    latestSnapshotRef.current = { ...library, syncRecords };
  }, [library, syncRecords]);

  useEffect(() => {
    if (!cloudLoginEnabled) return;

    let canceled = false;

    void getCurrentCloudSession(cloudSettings)
      .then((session) => {
        if (canceled) return;
        setCloudSession(session);
        setCloudStatus(session ? '准备同步' : '未登录');
      })
      .catch((error) => {
        if (canceled) return;
        setCloudStatus('云端连接失败');
        notify(errorMessage(error, '云端连接失败'));
      });

    const unsubscribe = subscribeToCloudAuth(
      (session) => {
        setCloudSession(session);
        setCloudStatus(session ? '准备同步' : '未登录');
        if (!session) {
          setCloudReadyUserId(null);
        }
      },
      cloudSettings,
    );

    return () => {
      canceled = true;
      unsubscribe();
    };
  }, [cloudLoginEnabled, cloudSettings]);

  useEffect(() => {
    if (!userId) {
      setCloudReadyUserId(null);
      return;
    }

    let canceled = false;
    setCloudStatus('正在加载云端数据');
    reconcileAndSave(userId, activeCloudSettings, 'login', () => canceled)
      .then((message) => {
        if (canceled || !message) return;
        setCloudReadyUserId(userId);
        setCloudStatus('云端已同步');
        notify(message);
      })
      .catch((error) => {
        if (canceled) return;
        setCloudStatus('同步失败');
        reportError('login', error, '云端同步失败');
      });

    return () => {
      canceled = true;
    };
  }, [activeCloudSettings, userId]);

  useEffect(() => {
    const snapshot = latestSnapshotRef.current;
    if (!userId || !isCloudReady || !snapshot) return;

    setCloudStatus('正在同步');
    const sessionCloudSettings = activeCloudSettings;
    const timer = window.setTimeout(() => {
      const syncRecord = createSyncRecord('auto', 'success', '自动同步完成');

      void saveCloudSnapshot(userId, stampSnapshot(snapshot, syncRecord), cloudUpdatedAtRef.current, sessionCloudSettings)
        .then((updatedAt) => {
          cloudUpdatedAtRef.current = updatedAt;
          addSyncRecord(syncRecord);
        })
        .catch((error) =>
          error instanceof CloudConflictError
            ? mergeCloudIntoLocal(userId, sessionCloudSettings, 'auto', '已合并其他设备的修改')
            : Promise.reject(error),
        )
        .then(() => setCloudStatus('云端已同步'))
        .catch((error) => {
          setCloudStatus('同步失败');
          reportError('auto', error, '云端同步失败');
        });
    }, AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [activeCloudSettings, library, isCloudReady, userId]);

  // 登录合并完成后，把本机有、云端还没有的文档文件补传上去（包括删除记录里的，方便恢复）。
  useEffect(() => {
    const snapshot = latestSnapshotRef.current;
    if (!snapshot || !isCloudReady) return;

    const files = [...snapshot.prompts, ...snapshot.deletedRecords.map((record) => record.prompt)].flatMap((item) =>
      item.file ? [item.file] : [],
    );
    void pushDocumentFiles(files);
  }, [cloudReadyUserId]);

  // 回到窗口时检查其他设备有没有改过云端，有就合并进来。
  useEffect(() => {
    if (!userId || !isCloudReady) return;

    const sessionCloudSettings = activeCloudSettings;
    const pullIfChanged = () => {
      void loadCloudUpdatedAt(userId, sessionCloudSettings)
        .then((updatedAt) =>
          updatedAt && updatedAt !== cloudUpdatedAtRef.current
            ? mergeCloudIntoLocal(userId, sessionCloudSettings, 'auto', '已拉取其他设备的修改')
            : undefined,
        )
        .catch((error) => {
          setCloudStatus('同步失败');
          addSyncRecord(createSyncRecord('auto', 'error', errorMessage(error, '拉取云端数据失败')));
        });
    };

    window.addEventListener('focus', pullIfChanged);
    return () => window.removeEventListener('focus', pullIfChanged);
  }, [activeCloudSettings, isCloudReady, userId]);

  // 返回给用户看的提示。
  const submitAuth = async (mode: 'signin' | 'signup', email: string, password: string) => {
    const supabaseSettings = getCloudSettingsForEmail(email, cloudSettings);
    if (!getCloudConfig(supabaseSettings).enabled) {
      throw new Error('还没有配置云端参数');
    }

    setCloudStatus(mode === 'signin' ? '正在登录' : '正在注册');
    if (mode === 'signin') {
      setCloudSession(await signInToCloud(email, password, supabaseSettings));
      return '已登录云同步';
    }

    const session = await signUpToCloud(email, password, supabaseSettings);
    if (session) {
      setCloudSession(session);
    }
    return session ? '已注册并登录云同步' : '注册成功，请按邮箱提示验证后登录';
  };

  const signOut = async () => {
    try {
      await signOutFromCloud(activeCloudSettings);
      setCloudSession(null);
      setCloudReadyUserId(null);
      setCloudStatus('未登录');
      notify('已退出云同步');
    } catch (error) {
      notify(errorMessage(error, '退出登录失败'));
    }
  };

  // 调用前 App 已确认云端已配置且已登录。
  const manualSync = async () => {
    if (!userId) return;

    setCloudStatus('正在手动同步');
    try {
      const message = await reconcileAndSave(userId, activeCloudSettings, 'manual');
      setCloudReadyUserId(userId);
      setCloudStatus('云端已同步');
      if (message) notify(message);
    } catch (error) {
      setCloudStatus('同步失败');
      reportError('manual', error, '手动同步失败');
    }
  };

  // 清空同步记录后立刻写一次云端，不等防抖（防抖不看同步记录本身）。
  const saveClearedSyncRecords = async (syncRecordsUpdatedAt: string) => {
    const snapshot = latestSnapshotRef.current;
    if (!userId || !isCloudReady || !snapshot) return;

    try {
      cloudUpdatedAtRef.current = await saveCloudSnapshot(
        userId,
        cleanCloudSnapshotRecords({
          ...snapshot,
          syncRecords: [],
          exportSettings: { ...normalizeExportSettings(snapshot.exportSettings), syncRecordsUpdatedAt },
          updatedAt: new Date().toISOString(),
        }),
        cloudUpdatedAtRef.current,
        activeCloudSettings,
      );
      setCloudStatus('云端已同步');
    } catch (error) {
      reportError('manual', error, '清空同步记录失败');
    }
  };

  // 设置页保存云端参数；只有管理员能改，改了就要重新登录。
  const updateCloudSettings = (nextCloudSettings: CloudSettings) => {
    const previousCloudSettings = loadCloudSettings();
    if (canManageCloudSettings) {
      saveCloudSettings(nextCloudSettings);
    }
    const savedCloudSettings = loadCloudSettings();
    setCloudSettings(savedCloudSettings);
    if (canManageCloudSettings && JSON.stringify(previousCloudSettings) !== JSON.stringify(savedCloudSettings)) {
      setCloudSession(null);
      setCloudReadyUserId(null);
      setCloudStatus(getCloudConfig(savedCloudSettings).enabled ? '未登录' : '未配置云端');
    }
  };

  return {
    cloudSettings,
    cloudEmail: cloudSession?.user.email ?? null,
    isSignedIn: Boolean(userId),
    cloudEnabled: activeCloudConfig.enabled,
    cloudLoginEnabled,
    cloudStatus,
    canManageCloudSettings,
    submitAuth,
    signOut,
    manualSync,
    saveClearedSyncRecords,
    updateCloudSettings,
    pushDocumentFiles,
    ensureDocumentLocal,
  };
}
