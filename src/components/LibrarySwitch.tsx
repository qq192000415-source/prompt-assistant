import { BookOpen, FileText, Images, Palette, Stamp } from 'lucide-react';
import type { LibraryMode } from '../localState';

const options: Array<{ mode: LibraryMode; label: string; icon: typeof BookOpen }> = [
  { mode: 'prompts', label: '提示词', icon: BookOpen },
  { mode: 'documents', label: '文档', icon: FileText },
  { mode: 'materials', label: '素材', icon: Images },
  { mode: 'canvas', label: '画布', icon: Palette },
  // 来图定制（1.18.0）：只有管理员开通了的账号才显示。
  { mode: 'custom', label: '定制', icon: Stamp },
];

type LibrarySwitchProps = {
  // null：都不选中（在设置页时）。
  libraryMode: LibraryMode | null;
  onChange: (mode: LibraryMode) => void;
  showCustom?: boolean;
  className?: string;
};

export function LibrarySwitch({ libraryMode, onChange, showCustom = false, className = '' }: LibrarySwitchProps) {
  return (
    <div className={`library-switch ${className}`} role="tablist" aria-label="切换库">
      {options.filter(({ mode }) => showCustom || mode !== 'custom').map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          className={`library-switch-option ${libraryMode === mode ? 'is-active' : ''}`}
          type="button"
          role="tab"
          aria-selected={libraryMode === mode}
          onClick={() => onChange(mode)}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}
