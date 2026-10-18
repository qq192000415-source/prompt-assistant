import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';

type NasSettingsFormProps = {
  config: NasConfig | null;
  busy: boolean;
  onSubmit: (input: { baseUrl: string; username: string; password?: string }) => Promise<boolean>;
  onSaved?: () => void;
};

export function NasSettingsForm({ config, busy, onSubmit, onSaved }: NasSettingsFormProps) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [username, setUsername] = useState(config?.username ?? '');
  const [password, setPassword] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSubmit({ baseUrl, username, password: password || undefined })) {
      setPassword('');
      onSaved?.();
    }
  };

  return (
    <form className="nas-form" onSubmit={(event) => void submit(event)}>
      <label className="field">
        WebDAV 地址
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://你的域名:端口/素材文件夹/"
          inputMode="url"
          spellCheck={false}
          required
        />
      </label>
      <label className="field">
        用户名
        <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" spellCheck={false} required />
      </label>
      <label className="field">
        密码
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={config?.hasPassword ? '已保存，不改就留空' : ''}
          autoComplete="current-password"
          required={!config?.hasPassword}
        />
      </label>
      <p className="nas-form-note">保存前会先连接一次 NAS，并在文件夹里建好 media 和 thumbs 两个子文件夹。密码用系统加密保存在这台电脑上。</p>
      <div className="nas-form-actions">
        <Button className="button primary" type="submit" disabled={busy}>
          {busy ? '正在连接…' : '连接并保存'}
        </Button>
      </div>
    </form>
  );
}

type NasSettingsDialogProps = Omit<NasSettingsFormProps, 'onSaved'> & { onClose: () => void };

export function NasSettingsDialog({ onClose, ...formProps }: NasSettingsDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="nas-settings-title">
      <Button className="modal-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      <section className="editor-panel category-editor-panel">
        <div className="editor-header">
          <h2 id="nas-settings-title">NAS 连接</h2>
          <Button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <NasSettingsForm {...formProps} onSaved={onClose} />
      </section>
    </div>
  );
}
