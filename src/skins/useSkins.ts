import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readCachedSkin, type SkinEntry } from '../lib/theme';
import { BUILTIN_SKINS } from './builtin';
import { buildSkinCss } from './skinPack';

// 安装的皮肤多带作者和版本，给设置页「皮肤」显示；启动时从缓存来的那一份没有。
export type InstalledSkinEntry = SkinEntry & { author?: string; version?: string };

const toEntry = ({ manifest, icons }: DesktopInstalledSkin): InstalledSkinEntry => {
  const assetUrl = (file: string) => `skin://${manifest.id}/${file}`;
  return {
    id: manifest.id,
    name: manifest.name,
    note: manifest.note,
    base: manifest.base,
    author: manifest.author,
    version: manifest.version,
    preview: assetUrl(manifest.preview),
    css: buildSkinCss(manifest, icons, assetUrl),
  };
};

// 内置皮肤 + 安装的皮肤包（桌面版才有）。读不了的皮肤逐个提示，不悄悄跳过。
export function useSkins(notify: (message: string) => void) {
  const [installed, setInstalled] = useState<InstalledSkinEntry[]>(() => {
    const cached = readCachedSkin();
    return cached && !BUILTIN_SKINS.some((skin) => skin.id === cached.id) ? [cached] : [];
  });
  const available = Boolean(window.promptAssistantDesktop?.skins);
  const [loaded, setLoaded] = useState(!available);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const reload = useCallback(async () => {
    const api = window.promptAssistantDesktop?.skins;
    if (!api) return;
    try {
      const { skins, errors } = await api.list();
      const entries: InstalledSkinEntry[] = [];
      for (const skin of skins) {
        try {
          entries.push(toEntry(skin));
        } catch (error) {
          errors.push({ id: skin.manifest.id, message: error instanceof Error ? error.message : String(error) });
        }
      }
      setInstalled(entries);
      for (const error of errors) notifyRef.current(`皮肤「${error.id}」读不了：${error.message}`);
    } catch (error) {
      notifyRef.current(`读取已安装的皮肤失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const skins = useMemo<SkinEntry[]>(() => [...BUILTIN_SKINS, ...installed], [installed]);
  return { skins, installed, loaded, available, reload };
}

export type SkinsController = ReturnType<typeof useSkins>;
