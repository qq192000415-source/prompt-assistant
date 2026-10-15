import { type FormEvent as ReactFormEvent, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button';
import { loadRememberedCloudLogin } from '../localState';

export type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

type CloseRequestDialogProps = {
  remember: boolean;
  onCancel: () => void;
  onRememberChange: (remember: boolean) => void;
  onTray: () => void;
  onQuit: () => void;
};

export function CloseRequestDialog({ remember, onCancel, onRememberChange, onTray, onQuit }: CloseRequestDialogProps) {
  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="close-request-title">
      <Button className="modal-backdrop" type="button" aria-label="取消关闭" onClick={onCancel} />
      <section className="editor-panel close-request-panel">
        <div className="editor-header">
          <div>
            <span className="eyebrow">Close</span>
            <h2 id="close-request-title">关闭软件？</h2>
          </div>
          <Button className="icon-button" type="button" aria-label="取消关闭" onClick={onCancel}>
            <X size={18} />
          </Button>
        </div>

        <div className="close-request-options">
          <Button className="settings-option close-choice" type="button" onClick={onTray}>
            <span>
              <strong>隐藏到托盘</strong>
              <small>软件继续后台运行，可从托盘或悬浮图标调出。</small>
            </span>
          </Button>
          <Button className="settings-option close-choice" type="button" onClick={onQuit}>
            <span>
              <strong>直接关闭软件</strong>
              <small>退出主程序，下次需要重新打开。</small>
            </span>
          </Button>
        </div>

        <label className="remember-close-option">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => onRememberChange(event.target.checked)}
          />
          <span>记住本次选择</span>
        </label>
      </section>
    </div>
  );
}

type ConfirmDialogProps = {
  dialog: ConfirmDialogState;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({ dialog, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <div className="confirm-dialog-layer" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className="confirm-dialog-copy">
          <h2 id="confirm-dialog-title">{dialog.title}</h2>
          <p>{dialog.message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <Button className="button ghost" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button className="button danger solid-danger" type="button" onClick={onConfirm} autoFocus>
            {dialog.confirmLabel ?? '确认'}
          </Button>
        </div>
      </section>
    </div>
  );
}

type CloudAuthPanelProps = {
  cloudEnabled: boolean;
  onClose: () => void;
  onSubmit: (mode: 'signin' | 'signup', email: string, password: string, remember: boolean) => Promise<void>;
};

export function CloudAuthPanel({ cloudEnabled, onClose, onSubmit }: CloudAuthPanelProps) {
  const rememberedLogin = useMemo(() => loadRememberedCloudLogin(), []);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState(rememberedLogin.email);
  const [password, setPassword] = useState(rememberedLogin.password);
  const [remember, setRemember] = useState(Boolean(rememberedLogin.email || rememberedLogin.password));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = cloudEnabled && email.trim().length > 0 && password.length >= 6 && !busy;

  const submit = async (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError('');
    try {
      await onSubmit(mode, email.trim(), password, remember);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="cloud-auth-title">
      <Button className="modal-backdrop" type="button" aria-label="关闭登录" onClick={onClose} />
      <form className="editor-panel auth-panel" onSubmit={submit}>
        <div className="editor-header">
          <div>
            <span className="eyebrow">Cloud Sync</span>
            <h2 id="cloud-auth-title">{mode === 'signin' ? '登录账户' : '注册账户'}</h2>
          </div>
          <Button className="icon-button" type="button" aria-label="关闭登录" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>

        {!cloudEnabled && (
          <div className="settings-section warning-section">
            <h3>还没有配置云端</h3>
            <p>先到设置里填写 Supabase URL 和 publishable key。</p>
          </div>
        )}

        <div className="auth-mode-switch" role="tablist" aria-label="账户操作">
          <Button className={mode === 'signin' ? 'active' : ''} type="button" onClick={() => setMode('signin')}>
            登录
          </Button>
          <Button className={mode === 'signup' ? 'active' : ''} type="button" onClick={() => setMode('signup')}>
            注册
          </Button>
        </div>

        <label className="field">
          <span>邮箱</span>
          <input
            type="email"
            value={email}
            placeholder="输入邮箱"
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            placeholder="至少 6 位"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label className="remember-login-option">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>保存账号和密码到这台电脑</span>
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="editor-footer">
          <Button className="button ghost" type="button" onClick={onClose}>
            取消
          </Button>
          <Button className="button primary" type="submit" disabled={!canSubmit}>
            {busy ? '处理中...' : mode === 'signin' ? '登录并同步' : '注册并同步'}
          </Button>
        </div>
      </form>
    </div>
  );
}

type CategoryCreatorDialogProps = {
  categories: string[];
  onClose: () => void;
  onCreate: (name: string) => boolean;
};

export function CategoryCreatorDialog({ categories, onClose, onCreate }: CategoryCreatorDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const normalizedName = name.trim();
  const canSave = normalizedName.length > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;

    if (categories.includes(normalizedName)) {
      setError('这个分类已经存在');
      return;
    }

    if (!onCreate(normalizedName)) {
      setError('分类名称无效或已存在');
    }
  };

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="category-create-title">
      <Button className="modal-backdrop" type="button" aria-label="关闭新增分类" onClick={onClose} />
      <form className="editor-panel category-editor-panel" onSubmit={handleSubmit}>
        <div className="editor-header">
          <div>
            <h2 id="category-create-title">新增分类</h2>
          </div>
          <Button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        <label className="field">
          <span>分类名称</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError('');
            }}
            placeholder="例如：运营"
            autoFocus
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="editor-footer">
          <Button className="button ghost" type="button" onClick={onClose}>
            取消
          </Button>
          <Button className="button primary" type="submit" disabled={!canSave}>
            创建分类
          </Button>
        </div>
      </form>
    </div>
  );
}
