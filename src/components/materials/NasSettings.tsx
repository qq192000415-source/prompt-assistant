import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { useMaterialSettings } from '../../materials/useMaterialLibrary';
import { AiSettingsForm } from './AiSettings';

type NasSettingsFormProps = {
  config: NasConfig | null;
  busy: boolean;
  onSubmit: (input: { baseUrl: string; username: string; password?: string }) => Promise<boolean>;
};

export function NasSettingsForm({ config, busy, onSubmit }: NasSettingsFormProps) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [username, setUsername] = useState(config?.username ?? '');
  const [password, setPassword] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSubmit({ baseUrl, username, password: password || undefined })) {
      setPassword('');
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

export type MaterialSettingsSectionName = 'nas' | 'ai' | 'network';

type MaterialSettingsSectionProps = {
  section: MaterialSettingsSectionName;
  notify: (message: string) => void;
};

// 设置页里素材库相关的三块：NAS 连接、AI 助手、网络。
export function MaterialSettingsSection({ section, notify }: MaterialSettingsSectionProps) {
  const settings = useMaterialSettings(notify);
  const busy = Boolean(settings.busy);

  if (!settings.available) return <p className="settings-note">桌面版运行时可用。</p>;
  if (section === 'network') return <ProxySettingsForm busy={busy} getProxy={settings.getProxy} saveProxy={settings.saveProxy} />;
  if (section === 'ai') {
    return (
      <AiSettingsForm
        busy={busy}
        getSettings={settings.aiGetSettings}
        saveSettings={settings.aiSaveSettings}
        listModels={settings.aiListModels}
        testModel={settings.aiTest}
      />
    );
  }
  // 等读到已保存的连接再渲染表单：表单只在第一次渲染时取初始值。
  return settings.config ? <NasSettingsForm config={settings.config} busy={busy} onSubmit={settings.saveConfig} /> : null;
}
