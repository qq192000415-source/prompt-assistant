// 桌面壳设置（关闭行为、悬浮图标）在渲染进程这边的默认值和归一。
export type DesktopSettingsInput = Partial<Omit<DesktopRuntimeSettings, 'floatingIcon'>> & {
  floatingIcon?: Partial<DesktopRuntimeSettings['floatingIcon']>;
};

export const defaultDesktopSettings: DesktopRuntimeSettings = {
  closeBehavior: 'ask',
  floatingIcon: {
    enabled: true,
    opacity: 0.9,
    x: null,
    y: null,
  },
};

const isDesktopCloseBehavior = (value: unknown): value is DesktopCloseBehavior =>
  value === 'ask' || value === 'quit' || value === 'tray';

const clampFloatingOpacity = (opacity: number) => Math.min(1, Math.max(0.25, opacity));

const normalizeDesktopCoordinate = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const normalizeDesktopSettings = (
  value?: DesktopSettingsInput | null,
  fallback: DesktopRuntimeSettings = defaultDesktopSettings,
): DesktopRuntimeSettings => {
  const source = value && typeof value === 'object' ? value : {};
  const sourceFloatingIcon = source.floatingIcon && typeof source.floatingIcon === 'object' ? source.floatingIcon : {};
  const fallbackFloatingIcon = fallback.floatingIcon;
  const opacity = Number(sourceFloatingIcon.opacity);

  return {
    closeBehavior: isDesktopCloseBehavior(source.closeBehavior) ? source.closeBehavior : fallback.closeBehavior,
    floatingIcon: {
      enabled:
        typeof sourceFloatingIcon.enabled === 'boolean'
          ? sourceFloatingIcon.enabled
          : fallbackFloatingIcon.enabled,
      opacity: Number.isFinite(opacity) ? clampFloatingOpacity(opacity) : fallbackFloatingIcon.opacity,
      x:
        sourceFloatingIcon.x === null || sourceFloatingIcon.x === undefined
          ? fallbackFloatingIcon.x ?? null
          : normalizeDesktopCoordinate(sourceFloatingIcon.x),
      y:
        sourceFloatingIcon.y === null || sourceFloatingIcon.y === undefined
          ? fallbackFloatingIcon.y ?? null
          : normalizeDesktopCoordinate(sourceFloatingIcon.y),
    },
  };
};
