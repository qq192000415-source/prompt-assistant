import { useEffect, useState } from 'react';
import { Check, Cloud, Copy, Download, ExternalLink, FolderOpen, LogIn, LogOut, RotateCcw } from 'lucide-react';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { MaterialSettingsSection } from './materials/NasSettings';
import { SkinSettings } from './SkinSettings';
import { themeOptions, type SkinEntry, type ThemeMode } from '../lib/theme';
import type { SkinsController } from '../skins/useSkins';
import type { CloudSettings } from '../cloudSync';
import type { ExportSettings } from '../librarySync';
import { type DesktopSettingsInput, normalizeDesktopSettings } from '../desktopSettings';
import { copyToClipboard, formatDate } from '../promptUtils';
import type { SyncRecord } from '../types';
import { APP_VERSION } from '../appMeta';

// 网页版地址（.env 的 VITE_WEB_URL，构建时写进去）；没配就不显示网页版入口。
const WEB_URL = import.meta.env.VITE_WEB_URL?.trim() ?? '';

const SECTIONS = [
  { key: 'general', label: '通用' },
  { key: 'skins', label: '皮肤' },
  { key: 'sync', label: '云同步' },
  { key: 'nas', label: '素材库（NAS）' },
  { key: 'ai', label: 'API 配置' },
  { key: 'network', label: '网络' },
  { key: 'about', label: '关于与更新' },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]['key'];

type SettingsPageProps = {
  section: SettingsSection;
  canManageCloud: boolean;
  cloudEmail: string | null;
  cloudEnabled: boolean;
  cloudSettings: CloudSettings;
  cloudStatus: string;
  desktopAvailable: boolean;
  desktopSettings: DesktopRuntimeSettings;
  exportSettings: ExportSettings;
  syncRecords: SyncRecord[];
  updateStatus: DesktopUpdateStatus;
  notify: (message: string) => void;
  onSectionChange: (section: SettingsSection) => void;
  onClearSyncRecords: () => void | Promise<void>;
  onCheckUpdate: () => void | Promise<void>;
  onDownloadUpdate: () => void | Promise<void>;
  onInstallUpdate: () => void | Promise<void>;
  onManualSync: () => void | Promise<void>;
  onOpenAuth: () => void;
  onSignOut: () => void;
  onSave: (settings: ExportSettings, cloudSettings: CloudSettings, desktopSettings: DesktopRuntimeSettings) => void;
  theme: ThemeMode;
  skins: ReadonlyArray<SkinEntry>;
  skinPacks: SkinsController;
  onThemeChange: (theme: ThemeMode) => void;
};

// 设置页替换内容区：左边分类，右边是当前分类的内容。通用和云同步的改动点「保存设置」才生效，
// 素材库、AI、网络各自的表单自己保存。
export function SettingsPage({
  section,
  canManageCloud,
  cloudEmail,
  cloudEnabled,
  cloudSettings,
  cloudStatus,
  desktopAvailable,
  desktopSettings,
  exportSettings,
  syncRecords,
  updateStatus,
  notify,
  onSectionChange,
  onClearSyncRecords,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onManualSync,
  onOpenAuth,
  onSignOut,
  onSave,
  theme,
  skins,
  skinPacks,
  onThemeChange,
}: SettingsPageProps) {
  const [draft, setDraft] = useState(exportSettings);
  const [cloudDraft, setCloudDraft] = useState(cloudSettings);
  const [desktopDraft, setDesktopDraft] = useState(desktopSettings);

  useEffect(() => {
    setDesktopDraft(desktopSettings);
  }, [desktopSettings]);

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
  const updateBusy = updateStatus.status === 'checking' || updateStatus.status === 'downloading' || updateStatus.status === 'installing';
  const canCheckUpdate = desktopAvailable && !updateBusy;
  const canDownloadUpdate = desktopAvailable && updateStatus.status === 'available';
  const canInstallUpdate = desktopAvailable && updateStatus.status === 'downloaded';
  const sectionLabel = SECTIONS.find((entry) => entry.key === section)?.label ?? '';
  const hasDraftForm = section === 'general' || section === 'sync';

  return (
    <main className="settings-page">
      <nav className="settings-nav" aria-label="设置分类">
        <strong>设置</strong>
        {SECTIONS.map((entry) => (
          <button
            key={entry.key}
            className={`settings-nav-item ${entry.key === section ? 'active' : ''}`}
            type="button"
            aria-current={entry.key === section ? 'page' : undefined}
            onClick={() => onSectionChange(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        <h2 className="settings-page-title">{sectionLabel}</h2>

        {hasDraftForm && (
          <form
            className="settings-form"
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
            {section === 'general' && (
              <>
                <section className="settings-section" aria-labelledby="appearance-settings-title">
                  <div>
                    <h3 id="appearance-settings-title">外观</h3>
                    <p>选一套主题或皮肤，马上生效，只保存在本机。顶部栏的主题按钮也能切换。</p>
                  </div>
                  <div className="theme-picker" role="radiogroup" aria-labelledby="appearance-settings-title">
                    {themeOptions(skins).map((entry) => (
                      <button
                        key={entry.value}
                        type="button"
                        role="radio"
                        className="theme-picker-option"
                        aria-checked={theme === entry.value}
                        onClick={() => onThemeChange(entry.value)}
                      >
                        <span className="theme-swatch" style={entry.swatch ? { background: entry.swatch[0] } : { background: `center / cover url("${entry.preview}")` }} aria-hidden="true">
                          {entry.swatch && <span style={{ background: entry.swatch[1] }} />}
                        </span>
                        <span className="theme-menu-text">
                          <strong>{entry.label}</strong>
                          <span>{entry.note}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <Separator />
                </section>

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
              </>
            )}

            {section === 'sync' && (
              <>
                <section className="settings-section" aria-labelledby="cloud-account-title">
                  <div className="settings-section-title">
                    <div>
                      <h3 id="cloud-account-title">账号</h3>
                      <p>{cloudEmail ? `${cloudEmail} · ${cloudStatus}` : cloudStatus}</p>
                      <p>提示词和文档会同步到云端；素材存在 NAS 上，不走云同步。</p>
                    </div>
                    {cloudEmail ? (
                      <div className="settings-header-actions">
                        <Button className="button ghost small-button" type="button" onClick={() => void onManualSync()}>
                          <Cloud size={15} />
                          立即同步
                        </Button>
                        <Button className="button ghost small-button" type="button" onClick={onSignOut}>
                          <LogOut size={15} />
                          退出登录
                        </Button>
                      </div>
                    ) : (
                      <Button className="button primary small-button" type="button" disabled={!cloudEnabled} onClick={onOpenAuth}>
                        <LogIn size={15} />
                        登录云端
                      </Button>
                    )}
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
              </>
            )}

            {(section === 'general' || canManageCloud) && (
              <div className="settings-form-footer">
                <Button className="button primary" type="submit">
                  保存设置
                </Button>
              </div>
            )}
          </form>
        )}

        {(section === 'nas' || section === 'ai' || section === 'network') && (
          <section className="settings-section">
            <MaterialSettingsSection section={section} notify={notify} adminEmail={canManageCloud && cloudEmail ? cloudEmail : null} />
          </section>
        )}

        {section === 'skins' && <SkinSettings skinPacks={skinPacks} theme={theme} onThemeChange={onThemeChange} notify={notify} />}

        {section === 'about' && (
          <>
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
                  <strong>灵匣{updateStatus.currentVersion || APP_VERSION}</strong>
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
              {updateStatus.downloadDir && (
                <p className="update-download-dir">
                  <span>
                    下载位置：<code>{updateStatus.downloadedFile || updateStatus.downloadDir}</code>。点「下载更新」后下完会自动安装，新版本启动后自动删掉这个安装包。
                  </span>
                  <Button
                    className="button ghost compact"
                    type="button"
                    onClick={() => void window.promptAssistantDesktop?.openUpdateFolder?.().then((error) => error && notify(error))}
                  >
                    <FolderOpen size={14} />
                    打开下载目录
                  </Button>
                </p>
              )}
            </section>

            {WEB_URL && desktopAvailable && (
              <section className="settings-section" aria-labelledby="web-version-title">
                <div className="settings-section-title">
                  <div>
                    <h3 id="web-version-title">网页版</h3>
                    <p>浏览器里打开就能用提示词库和文档库，登录同一个账号自动同步。素材库和画布只在桌面版里。</p>
                  </div>
                </div>
                <p className="update-download-dir">
                  <span>
                    地址：<code>{WEB_URL}</code>
                  </span>
                  <Button className="button ghost compact" type="button" onClick={() => void copyToClipboard(WEB_URL).then(() => notify('网页版地址已复制，发给别人用浏览器打开即可'))}>
                    <Copy size={14} />
                    复制链接
                  </Button>
                  <Button className="button ghost compact" type="button" onClick={() => window.open(WEB_URL, '_blank')}>
                    <ExternalLink size={14} />
                    在浏览器打开
                  </Button>
                </p>
              </section>
            )}

            <section className="settings-section about-section" id="software-about-panel" aria-labelledby="software-about-title">
              <div>
                <h3 id="software-about-title">软件说明</h3>
                <p>灵匣采用安静、紧凑的工作台设计，提示词、文档、素材和创作画布各占一个标签页。</p>
              </div>

              <div className="about-layout-grid">
                <div>
                  <strong>UI 布局</strong>
                  <p>顶部是主导航，在提示词、文档、素材、画布之间切换，右边是云同步状态、深浅色和设置；提示词和文档的左侧是搜索、视图、分类树、创建入口和云端状态，右侧是正文区，支持查看、编辑、复制、收藏和删除。</p>
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
          </>
        )}
      </div>
    </main>
  );
}
