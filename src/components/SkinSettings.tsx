import { useState, type DragEvent } from 'react';
import { Check, Download, PackagePlus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import type { ThemeMode } from '../lib/theme';
import type { SkinsController } from '../skins/useSkins';

const SKIN_FORMAT_URL = 'https://github.com/qq192000415-source/prompt-assistant/tree/main/themes';

type SkinSettingsProps = {
  skinPacks: SkinsController;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  notify: (message: string) => void;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error));

// 设置页「皮肤」：安装（选文件或拖进来）、导出、删除皮肤包。内置的六套在「通用 › 外观」里选。
export function SkinSettings({ skinPacks, theme, onThemeChange, notify }: SkinSettingsProps) {
  const api = window.promptAssistantDesktop?.skins;
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const report = async (run: () => Promise<DesktopSkinInstallResult | null>) => {
    setBusy(true);
    try {
      const result = await run();
      if (!result) return;
      for (const skin of result.installed) notify(`${skin.replaced ? '已更新' : '已安装'}皮肤「${skin.name}」`);
      for (const error of result.errors) notify(`${error.name} 没装上：${error.message}`);
      if (result.installed.length) await skinPacks.reload();
    } catch (error) {
      notify(`安装皮肤失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!api || busy) return;
    const files = [...event.dataTransfer.files];
    const zips = files.filter((file) => file.name.toLowerCase().endsWith('.zip'));
    if (zips.length < files.length) notify('皮肤包是 .zip 文件，其余的没有安装');
    if (zips.length) void report(() => api.installPaths(zips.map((file) => api.pathForFile(file))));
  };

  const remove = async (id: string, name: string) => {
    if (!api) return;
    setConfirmingId(null);
    try {
      await api.remove(id);
      notify(`已删除皮肤「${name}」`);
      await skinPacks.reload();
    } catch (error) {
      notify(`删除皮肤失败：${errorText(error)}`);
    }
  };

  const exportSkin = async (id: string) => {
    if (!api) return;
    try {
      const target = await api.exportSkin(id);
      if (target) notify(`已导出到 ${target}`);
    } catch (error) {
      notify(`导出皮肤失败：${errorText(error)}`);
    }
  };

  return (
    <section className="settings-section" aria-labelledby="skin-settings-title">
      <div className="settings-section-title">
        <div>
          <h3 id="skin-settings-title">皮肤包</h3>
          <p>
            安装别人做的皮肤（.zip），换配色、壁纸和图标，只改外观。自己做皮肤照{' '}
            <a className="skin-format-link" href={SKIN_FORMAT_URL} target="_blank" rel="noreferrer">
              皮肤包格式说明
            </a>
            。
          </p>
        </div>
        <Button className="button primary small-button" type="button" disabled={!api || busy} onClick={() => api && void report(api.pickAndInstall)}>
          <PackagePlus size={15} />
          {busy ? '正在安装…' : '安装皮肤包'}
        </Button>
      </div>

      {!api ? (
        <p className="settings-note">桌面版运行时可用。</p>
      ) : (
        <div
          className={`skin-drop-zone ${dragging ? 'is-dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {!skinPacks.loaded ? (
            <p className="settings-note">正在读取…</p>
          ) : skinPacks.installed.length ? (
            <ul className="skin-pack-list">
              {skinPacks.installed.map((skin) => {
                const value = `skin:${skin.id}` as ThemeMode;
                const active = theme === value;
                return (
                  <li className="skin-pack-item" key={skin.id}>
                    <img className="skin-pack-preview" src={skin.preview} alt="" />
                    <div className="skin-pack-text">
                      <strong>{skin.name}</strong>
                      <span>{[skin.note, skin.author && `作者 ${skin.author}`, skin.version && `v${skin.version}`].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="skin-pack-actions">
                      <Button className="button ghost small-button" type="button" disabled={active} onClick={() => onThemeChange(value)}>
                        {active ? <Check size={14} /> : null}
                        {active ? '使用中' : '使用'}
                      </Button>
                      <Button className="button ghost small-button" type="button" title="导出成 .zip" onClick={() => void exportSkin(skin.id)}>
                        <Download size={14} />
                        导出
                      </Button>
                      {confirmingId === skin.id ? (
                        <Button className="button danger solid-danger small-button" type="button" onClick={() => void remove(skin.id, skin.name)}>
                          确认删除
                        </Button>
                      ) : (
                        <Button className="button ghost small-button" type="button" aria-label={`删除皮肤「${skin.name}」`} onClick={() => setConfirmingId(skin.id)}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="settings-note">还没有安装皮肤包。点「安装皮肤包」选 .zip，或者把 .zip 拖到这里。</p>
          )}
        </div>
      )}
    </section>
  );
}
