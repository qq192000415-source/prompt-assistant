import { useEffect, useState } from 'react';
import { Check, Download, Info, RotateCcw, X } from 'lucide-react';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { Switch } from './ui/switch';
import type { ThemeMode } from '../lib/theme';
import type { CloudSettings } from '../cloudSync';
import type { ExportSettings } from '../librarySync';
import { type DesktopSettingsInput, normalizeDesktopSettings } from '../desktopSettings';
import { formatDate } from '../promptUtils';
import type { SyncRecord } from '../types';
import { APP_VERSION } from '../appMeta';

type SettingsPanelProps = {
  canManageCloud: boolean;
  cloudSettings: CloudSettings;
  desktopAvailable: boolean;
  desktopSettings: DesktopRuntimeSettings;
  exportSettings: ExportSettings;
  initialAboutOpen: boolean;
  syncRecords: SyncRecord[];
  updateStatus: DesktopUpdateStatus;
  onClearSyncRecords: () => void | Promise<void>;
  onClose: () => void;
  onCheckUpdate: () => void | Promise<void>;
  onDownloadUpdate: () => void | Promise<void>;
  onInstallUpdate: () => void | Promise<void>;
  onSave: (settings: ExportSettings, cloudSettings: CloudSettings, desktopSettings: DesktopRuntimeSettings) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
};

export function SettingsPanel({
  canManageCloud,
  cloudSettings,
  desktopAvailable,
  desktopSettings,
  exportSettings,
  initialAboutOpen,
  syncRecords,
  updateStatus,
  onClearSyncRecords,
  onClose,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onSave,
  theme,
  onThemeChange,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState(exportSettings);
  const [cloudDraft, setCloudDraft] = useState(cloudSettings);
  const [desktopDraft, setDesktopDraft] = useState(desktopSettings);
  const [aboutOpen, setAboutOpen] = useState(initialAboutOpen);

  useEffect(() => {
    setDesktopDraft(desktopSettings);
  }, [desktopSettings]);

  useEffect(() => {
    setAboutOpen(initialAboutOpen);
  }, [initialAboutOpen]);

  const updateDraft = (next: Partial<ExportSettings>) => {
    setDraft((current) => ({ ...current, ...next }));
  };

  const updateCloudDraft = (next: Partial<CloudSettings>) => {
    setCloudDraft((current) => ({ ...current, ...next }));
  };

  const updateDesktopDraft = (next: DesktopSettingsInput) => {
    setDesktopDraft((current) =>
      normalizeDesktopSettings(
        {
          ...current,
          ...next,
          floatingIcon: {
            ...current.floatingIcon,
            ...(next.floatingIcon ?? {}),
          },
        },
        current,
      ),
    );
  };

  const floatingOpacityPercent = Math.round(desktopDraft.floatingIcon.opacity * 100);
  const updateProgressPercent = Math.round(updateStatus.progress?.percent ?? 0);
  const updateBusy = updateStatus.status === 'checking' || updateStatus.status === 'downloading';
  const canCheckUpdate = desktopAvailable && !updateBusy;
  const canDownloadUpdate = desktopAvailable && updateStatus.status === 'available';
  const canInstallUpdate = desktopAvailable && updateStatus.status === 'downloaded';

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="settings-panel-title">
      <Button className="modal-backdrop" type="button" aria-label="关闭设置" onClick={onClose} />
      <form
        className="editor-panel settings-panel"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(
            { ...draft, pathHint: draft.pathHint.trim() },
            {
              ...cloudDraft,
              provider: cloudDraft.provider === 'none' ? 'none' : 'supabase',
              supabaseUrl: cloudDraft.supabaseUrl.trim().replace(/\/+$/, ''),
              supabaseAnonKey: cloudDraft.supabaseAnonKey.trim(),
              adminEmails: cloudDraft.adminEmails.map((email) => email.trim().toLowerCase()).filter(Boolean),
            },
            normalizeDesktopSettings(desktopDraft),
          );
        }}
      >
        <div className="editor-header">
          <div>
            <span className="eyebrow">Settings</span>
            <h2 id="settings-panel-title">设置</h2>
          </div>
          <div className="settings-header-actions">
            <Button
              className={`button ghost small-button ${aboutOpen ? 'accent' : ''}`}
              type="button"
              aria-expanded={aboutOpen}
              aria-controls="software-about-panel"
              onClick={() => setAboutOpen((open) => !open)}
            >
              <Info size={15} />
              软件说明
            </Button>
            <Button className="icon-button" type="button" aria-label="关闭设置" onClick={onClose}>
              <X size={18} />
            </Button>
          </div>
        </div>

        {aboutOpen && (
          <section className="settings-section about-section" id="software-about-panel" aria-labelledby="software-about-title">
            <div>
              <h3 id="software-about-title">软件说明</h3>
              <p>提示词助手采用安静、紧凑的双栏工作台设计，让分类管理和正文阅读保持在同一屏。</p>
            </div>

            <div className="about-layout-grid">
              <div>
                <strong>UI 布局</strong>
                <p>顶部菜单栏负责筛选、导入导出、设置和搜索；左侧是分类树、创建入口和云端状态；右侧是提示词正文区，支持查看、编辑、复制、收藏和删除。</p>
              </div>
              <div>
                <strong>视觉风格</strong>
                <p>界面使用中性灰表面、发丝级边框、8px 圆角和单一蓝色强调色，并支持浅色与深色。目标是长时间阅读正文时清晰、稳定、不抢内容。</p>
              </div>
              <div>
                <strong>设计思路</strong>
                <p>主文件夹对应一级分类，子标题对应提示词标题，正文直接完整展示，减少列表和详情之间反复切换。</p>
              </div>
              <div>
                <strong>技术组成</strong>
                <p>TypeScript 和 React 负责界面与状态；设计令牌与 CSS 负责布局和视觉；Vite 负责开发服务和前端构建；Electron 负责 Windows 桌面窗口、托盘、悬浮图标和打包；Node.js 负责脚本、测试和 Supabase 发布工作流。</p>
              </div>
            </div>
          </section>
        )}

        <section className="settings-section" aria-labelledby="appearance-settings-title">
          <div className="settings-section-title">
            <div>
              <h3 id="appearance-settings-title">外观</h3>
              <p>浅色适合长时间阅读，深色适合弱光环境。这个选择只保存在本机。</p>
            </div>
            <Switch
              checked={theme === 'dark'}
              aria-label="深色模式"
              onCheckedChange={(checked) => onThemeChange(checked ? 'dark' : 'light')}
            />
          </div>
          <Separator />
        </section>

        <section className="settings-section" aria-labelledby="update-settings-title">
          <div className="settings-section-title">
            <div>
              <h3 id="update-settings-title">软件更新</h3>
              <p>自动更新仅支持安装版，便携版和文件夹版仍用于测试和排查。</p>
            </div>
            <Button className="button ghost small-button" type="button" disabled={!canCheckUpdate} onClick={() => void onCheckUpdate()}>
              <RotateCcw size={15} />
              检查更新
            </Button>
          </div>

          <div className={`update-status-card ${updateStatus.status}`}>
            <div>
              <span>当前版本</span>
              <strong>提示词助手{updateStatus.currentVersion || APP_VERSION}</strong>
            </div>
            <div>
              <span>更新状态</span>
              <strong>{updateStatus.message}</strong>
              {updateStatus.availableVersion && <small>最新版本：{updateStatus.availableVersion}</small>}
            </div>
          </div>

          {updateStatus.status === 'downloading' && (
            <div className="update-progress" aria-label={`更新下载进度 ${updateProgressPercent}%`}>
              <span style={{ width: `${Math.min(100, Math.max(0, updateProgressPercent))}%` }} />
            </div>
          )}

          <div className="update-actions">
            <Button className="button ghost" type="button" disabled={!canDownloadUpdate} onClick={() => void onDownloadUpdate()}>
              <Download size={16} />
              下载更新
            </Button>
            <Button className="button primary" type="button" disabled={!canInstallUpdate} onClick={() => void onInstallUpdate()}>
              <Check size={16} />
              重启安装
            </Button>
          </div>
        </section>

        {canManageCloud && (
          <section className="settings-section" aria-labelledby="cloud-settings-title">
            <div>
              <h3 id="cloud-settings-title">云同步设置</h3>
              <p>填写 VITE_ADMIN_EMAILS 后，只有这些账号可以修改 Supabase 配置。未配置管理员时，本机可以直接修改。普通用户登录后只同步自己的数据。</p>
            </div>

            <label className="field">
              <span>云同步总开关</span>
              <select
                value={cloudDraft.provider === 'none' ? 'none' : 'enabled'}
                onChange={(event) => {
                  updateCloudDraft({
                    provider: event.target.value === 'none' ? 'none' : 'supabase',
                  });
                }}
              >
                <option value="none">关闭云同步</option>
                <option value="enabled">开启云同步</option>
              </select>
            </label>
            <p className="settings-note">云同步现在统一使用 Supabase Auth 和 prompt_libraries，每个登录账号只读写自己的数据。</p>

            {cloudDraft.provider !== 'none' && (
              <>
                <div className="cloud-route-summary">
                  <div>
                    <span>管理员账号</span>
                    <strong>{cloudDraft.adminEmails.length > 0 ? cloudDraft.adminEmails.join('、') : '未配置'}</strong>
                    <small>{cloudDraft.adminEmails.length > 0 ? '可修改 Supabase 配置' : '本机可以直接修改云端配置'}</small>
                  </div>
                  <div>
                    <span>数据存储</span>
                    <strong>Supabase</strong>
                    <small>普通用户不能修改云端配置</small>
                  </div>
                </div>

              </>
            )}

            {cloudDraft.provider !== 'none' && (
              <div className="settings-grid">
                <label className="field">
                  <span>Supabase URL</span>
                  <input
                    value={cloudDraft.supabaseUrl}
                    placeholder="https://xxxx.supabase.co"
                    onChange={(event) => updateCloudDraft({ supabaseUrl: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Supabase anon key</span>
                  <input
                    value={cloudDraft.supabaseAnonKey}
                    placeholder="粘贴 publishable / anon key"
                    onChange={(event) => updateCloudDraft({ supabaseAnonKey: event.target.value })}
                  />
                </label>
              </div>
            )}

          </section>
        )}

        <section className="settings-section" aria-labelledby="window-close-settings-title">
          <div>
            <h3 id="window-close-settings-title">关闭窗口</h3>
            {!desktopAvailable && <p>桌面版运行时可用。</p>}
          </div>

          <div className="settings-options">
            {[
              { value: 'ask', title: '每次询问', description: '点击窗口 X 时选择关闭软件或隐藏到托盘。' },
              { value: 'tray', title: '隐藏到托盘', description: '点击窗口 X 后保留后台运行，可从托盘或悬浮图标调出。' },
              { value: 'quit', title: '直接关闭软件', description: '点击窗口 X 后退出主程序。' },
            ].map((option) => (
              <label className={`settings-option ${!desktopAvailable ? 'is-disabled' : ''}`} key={option.value}>
                <input
                  type="radio"
                  name="close-behavior"
                  checked={desktopDraft.closeBehavior === option.value}
                  disabled={!desktopAvailable}
                  onChange={() => updateDesktopDraft({ closeBehavior: option.value as DesktopCloseBehavior })}
                />
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section" aria-labelledby="floating-icon-settings-title">
          <div>
            <h3 id="floating-icon-settings-title">悬浮图标</h3>
            {!desktopAvailable && <p>桌面版运行时可用。</p>}
          </div>

          <div className="desktop-settings-grid">
            <label className={`settings-option toggle-option ${!desktopAvailable ? 'is-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={desktopDraft.floatingIcon.enabled}
                disabled={!desktopAvailable}
                onChange={(event) => updateDesktopDraft({ floatingIcon: { enabled: event.target.checked } })}
              />
              <span>
                <strong>显示悬浮图标</strong>
                <small>单击调出主界面，右键可关闭。</small>
              </span>
            </label>

            <label className={`floating-opacity-control ${!desktopDraft.floatingIcon.enabled ? 'is-disabled' : ''}`}>
              <span>
                <strong>透明度</strong>
                <b>{floatingOpacityPercent}%</b>
              </span>
              <input
                type="range"
                min="25"
                max="100"
                step="5"
                value={floatingOpacityPercent}
                disabled={!desktopAvailable || !desktopDraft.floatingIcon.enabled}
                onChange={(event) =>
                  updateDesktopDraft({ floatingIcon: { opacity: Number(event.target.value) / 100 } })
                }
              />
            </label>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="export-settings-title">
          <div>
            <h3 id="export-settings-title">导出设置</h3>
            <p>设置导出文件时的保存方式。</p>
          </div>

          <div className="settings-options">
            <label className="settings-option">
              <input
                type="radio"
                name="export-mode"
                checked={draft.mode === 'download'}
                onChange={() => updateDraft({ mode: 'download' })}
              />
              <span>
                <strong>浏览器默认下载目录</strong>
                <small>点击导出后直接下载到浏览器默认目录。</small>
              </span>
            </label>
            <label className="settings-option">
              <input
                type="radio"
                name="export-mode"
                checked={draft.mode === 'picker'}
                onChange={() => updateDraft({ mode: 'picker' })}
              />
              <span>
                <strong>导出时选择保存位置</strong>
                <small>支持的浏览器会弹出系统保存窗口。</small>
              </span>
            </label>
          </div>

          <label className="field">
            <span>路径备注</span>
            <input
              value={draft.pathHint}
              placeholder={'例如：D:\\提示词备份'}
              onChange={(event) => updateDraft({ pathHint: event.target.value })}
            />
          </label>
          <p className="settings-note">浏览器安全规则不允许网页静默写入固定本地路径；选择保存位置时，会在导出时弹出保存窗口。</p>
        </section>

        <section className="settings-section" aria-labelledby="sync-record-settings-title">
          <div className="settings-section-title">
            <div>
              <h3 id="sync-record-settings-title">同步记录</h3>
              <p>这里只记录同步动作，自动保留最近 30 天。清空记录不会删除本地或云端提示词。</p>
            </div>
            <Button className="button ghost small-button" type="button" disabled={!syncRecords.length} onClick={() => void onClearSyncRecords()}>
              清空记录
            </Button>
          </div>

          {syncRecords.length ? (
            <div className="sync-record-list">
              {syncRecords.map((record) => (
                <div className={`sync-record-item ${record.status}`} key={record.id}>
                  <span>{record.status === 'success' ? '成功' : '失败'}</span>
                  <strong>{record.message}</strong>
                  <small>
                    {formatDate(record.createdAt)} ·{' '}
                    {record.action === 'manual' ? '手动同步' : record.action === 'login' ? '登录同步' : '自动同步'}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-note">暂无同步记录。</p>
          )}
        </section>

        <div className="editor-footer">
          <Button className="button ghost" type="button" onClick={onClose}>
            取消
          </Button>
          <Button className="button primary" type="submit">
            保存设置
          </Button>
        </div>
      </form>
    </div>
  );
}
