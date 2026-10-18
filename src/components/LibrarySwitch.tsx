import { BookOpen, FileText, Images, Palette } from 'lucide-react';
import type { LibraryMode } from '../localState';

const options: Array<{ mode: LibraryMode; label: string; icon: typeof BookOpen }> = [
  { mode: 'prompts', label: '提示词', icon: BookOpen },
  { mode: 'documents', label: '文档', icon: FileText },
  { mode: 'materials', label: '素材', icon: Images },
  { mode: 'canvas', label: '画布', icon: Palette },
];

type LibrarySwitchProps = {
  libraryMode: LibraryMode;
  onChange: (mode: LibraryMode) => void;
  className?: string;
};

export function LibrarySwitch({ libraryMode, onChange, className = '' }: LibrarySwitchProps) {
  return (
    <div className={`library-switch ${className}`} role="tablist" aria-label="切换库">
      {options.map(({ mode, label, icon: Icon }) => (
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
