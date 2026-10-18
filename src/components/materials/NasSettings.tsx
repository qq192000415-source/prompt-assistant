import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { AiSettingsForm } from './AiSettings';

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

type ProxyResult = { name: string; ok: boolean; detail: string };

type ProxySettingsFormProps = {
  busy: boolean;
  getProxy: () => Promise<MaterialProxySettings>;
  saveProxy: (settings: MaterialProxySettings) => Promise<{ settings: MaterialProxySettings; results: ProxyResult[] } | null>;
};

// 只影响抓取分享链接（即梦、X 等），不影响连接 NAS、云同步和检查更新。
function ProxySettingsForm({ busy, getProxy, saveProxy }: ProxySettingsFormProps) {
  const [settings, setSettings] = useState<MaterialProxySettings | null>(null);
  const [results, setResults] = useState<ProxyResult[]>([]);

  // 只在打开时读一次：getProxy 每次渲染都是新函数。
  useEffect(() => {
    void getProxy().then(setSettings);
  }, []);

  if (!settings) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await saveProxy(settings);
    if (saved) {
      setSettings(saved.settings);
      setResults(saved.results);
    }
  };

  return (
    <form className="nas-form" onSubmit={(event) => void submit(event)}>
      <label className="field">
        抓取分享链接时
        <select value={settings.mode} onChange={(event) => setSettings({ ...settings, mode: event.target.value as MaterialProxySettings['mode'] })}>
          <option value="system">跟随系统代理</option>
          <option value="direct">直连，不用代理</option>
          <option value="custom">自定义代理</option>
        </select>
      </label>
      {settings.mode === 'custom' && (
        <label className="field">
          代理地址
          <input
            value={settings.url}
            onChange={(event) => setSettings({ ...settings, url: event.target.value })}
            placeholder="http://127.0.0.1:7890"
            spellCheck={false}
            required
          />
        </label>
      )}
      <p className="nas-form-note">只影响从即梦、X 等网站抓取提示词和效果图，不影响连接 NAS、云同步和检查更新。</p>
      {results.length > 0 && (
        <ul className="proxy-results">
          {results.map((result) => (
            <li key={result.name} className={result.ok ? 'is-ok' : 'is-fail'}>
              <strong>{result.name}</strong>
              <span>{result.ok ? '能连上' : '连不上'} · {result.detail}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="nas-form-actions">
        <Button className="button ghost" type="submit" disabled={busy}>
          {busy ? '正在测试…' : '保存并测试'}
        </Button>
      </div>
    </form>
  );
}

type NasSettingsDialogProps = Omit<NasSettingsFormProps, 'onSaved'> &
  ProxySettingsFormProps & { ai: Omit<Parameters<typeof AiSettingsForm>[0], 'busy'>; onClose: () => void };

export function NasSettingsDialog({ onClose, getProxy, saveProxy, ai, ...formProps }: NasSettingsDialogProps) {
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
          <h2 id="nas-settings-title">素材库设置</h2>
          <Button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <h3 className="settings-subheading">NAS 连接</h3>
        <NasSettingsForm {...formProps} onSaved={onClose} />
        <h3 className="settings-subheading">网络</h3>
        <ProxySettingsForm busy={formProps.busy} getProxy={getProxy} saveProxy={saveProxy} />
        <h3 className="settings-subheading">AI 助手</h3>
        <AiSettingsForm busy={formProps.busy} {...ai} />
      </section>
    </div>
  );
}
