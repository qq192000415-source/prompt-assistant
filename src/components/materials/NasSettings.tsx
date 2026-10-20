import { useEffect, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/button';
import { deleteNasGrant, listNasGrants, normalizeCloudEmail, saveNasGrant, type NasGrant } from '../../cloudSync';
import { useMaterialSettings } from '../../materials/useMaterialLibrary';
import { AiSettingsForm } from './AiSettings';

type NasSettingsFormProps = {
  config: NasConfig | null;
  busy: boolean;
  onSubmit: (input: { baseUrl: string; username: string; password?: string }) => Promise<boolean>;
};

// 默认用圆点遮住，点眼睛看明文。value 由外面管，这里只管显示方式。
function MaskedInput({ label, value, onChange, revealable = true, onReveal, ...rest }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  revealable?: boolean;
  // 密码平时不在界面里，点眼睛时才去主进程取。
  onReveal?: () => Promise<void>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      {label}
      <span className="masked-input">
        <input {...rest} type={shown ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} />
        <button
          type="button"
          className="icon-button compact-icon"
          aria-label={shown ? `隐藏${label}` : `显示${label}`}
          title={revealable ? (shown ? '隐藏' : '显示明文') : '管理员授权的连接不显示密码'}
          disabled={!revealable}
          onClick={async () => {
            if (!shown && onReveal) await onReveal();
            setShown(!shown);
          }}
        >
          {shown ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </span>
    </label>
  );
}

export function NasSettingsForm({ config, busy, onSubmit }: NasSettingsFormProps) {
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [username, setUsername] = useState(config?.username ?? '');
  const [password, setPassword] = useState('');
  // 点了「清空」就当作要换成自己的 NAS：不再沿用已保存的密码。
  const [cleared, setCleared] = useState(false);
  const granted = config?.source === 'grant' && !cleared;
  const keepsPassword = Boolean(config?.hasPassword) && !cleared;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await onSubmit({ baseUrl, username, password: password || undefined })) {
      setPassword('');
      setCleared(false);
    }
  };

  const revealPassword = async () => {
    if (password || !keepsPassword) return;
    try {
      setPassword((await window.promptAssistantDesktop!.materials!.revealConfig()).password);
    } catch {
      // 读不到就保持空着，不影响保存（留空 = 沿用已保存的密码）。
    }
  };

  return (
    <form className="nas-form" onSubmit={(event) => void submit(event)}>
      {granted && <p className="nas-form-note">这是管理员授权给你的 NAS 连接，登录后自动连上，密码不显示。想用自己的 NAS，点「清空」后填写自己的。</p>}
      <MaskedInput label="WebDAV 地址" value={baseUrl} onChange={setBaseUrl} placeholder="https://你的域名:端口/素材文件夹/" autoComplete="off" required />
      <MaskedInput label="用户名" value={username} onChange={setUsername} autoComplete="off" required />
      <MaskedInput
        label="密码"
        value={password}
        onChange={setPassword}
        revealable={!granted}
        onReveal={revealPassword}
        placeholder={keepsPassword ? '已保存，不改就留空' : ''}
        autoComplete="current-password"
        required={!keepsPassword}
      />
      <p className="nas-form-note">保存前会先连接一次 NAS。每个账号的素材放在这个文件夹里以登录邮箱命名的子文件夹中。密码用系统加密保存在这台电脑上。</p>
      <div className="nas-form-actions">
        {(config?.baseUrl || baseUrl || username) && (
          <Button
            className="button ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              setBaseUrl('');
              setUsername('');
              setPassword('');
              setCleared(true);
            }}
          >
            清空
          </Button>
        )}
        <Button className="button primary" type="submit" disabled={busy}>
          {busy ? '正在连接…' : '连接并保存'}
        </Button>
      </div>
    </form>
  );
}

// 管理员给其他账号开通 NAS 连接：对方登录后自动连上，素材放在自己邮箱命名的子文件夹里。
// 授权的是管理员这台电脑上现在的连接；管理员改了连接（比如换密码）保存后，已授权的账号会一起更新。
function NasGrantsPanel({ adminEmail, notify }: { adminEmail: string; notify: (message: string) => void }) {
  const [grants, setGrants] = useState<NasGrant[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState('');
  const self = normalizeCloudEmail(adminEmail);

  const reload = () =>
    listNasGrants().then(
      (list) => {
        setGrants(list);
        setLoadError('');
      },
      (error) => setLoadError(messageOf(error)),
    );
  useEffect(() => {
    void reload();
  }, []);

  const act = async (action: () => Promise<void>, done: string) => {
    setWorking(true);
    try {
      await action();
      notify(done);
      await reload();
    } catch (error) {
      notify(messageOf(error));
    } finally {
      setWorking(false);
      setConfirming('');
    }
  };

  const grant = (target: string) =>
    act(async () => {
      const own = await window.promptAssistantDesktop!.materials!.revealConfig();
      await saveNasGrant({ email: target, baseUrl: own.baseUrl, username: own.username, password: own.password });
    }, `已给 ${target} 开通 NAS 连接，对方下次启动或登录时自动连上`);

  return (
    <section className="nas-grants" aria-labelledby="nas-grants-title">
      <h3 id="nas-grants-title">授权管理</h3>
      <p className="nas-form-note">给其他账号开通这台电脑上现在的 NAS 连接。对方登录后自动连上，看不到密码，素材放在自己邮箱命名的子文件夹里；收回后对方下次启动或登录时断开。大家共用同一个 NAS 用户，所以这只是软件里互相看不到，要彻底收回请在 NAS 上改密码。</p>
      {loadError ? (
        <p className="canvas-detail-error" role="alert">
          {loadError}
        </p>
      ) : (
        <>
          <form
            className="nas-grants-add"
            onSubmit={(event) => {
              event.preventDefault();
              const target = normalizeCloudEmail(email);
              if (target) void grant(target).then(() => setEmail(''));
            }}
          >
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="对方的登录邮箱" aria-label="对方的登录邮箱" required />
            <Button className="button primary" type="submit" disabled={working}>
              授权
            </Button>
          </form>
          {grants === null ? (
            <p className="nas-form-note">正在读取授权…</p>
          ) : (
            <ul className="nas-grants-list">
              {grants.map((entry) => (
                <li key={entry.email}>
                  <span>
                    <strong>{entry.email}</strong>
                    {entry.email === self ? '（你自己：换电脑登录后自动填好）' : ''}
                  </span>
                  {entry.email !== self &&
                    (confirming === entry.email ? (
                      <Button className="button danger compact" type="button" disabled={working} onClick={() => void act(() => deleteNasGrant(entry.email), `已收回 ${entry.email} 的 NAS 连接`)}>
                        确认收回
                      </Button>
                    ) : (
                      <Button className="button ghost compact" type="button" onClick={() => setConfirming(entry.email)}>
                        收回
                      </Button>
                    ))}
                </li>
              ))}
              {grants.length === 0 && <li className="nas-form-note">还没有授权给任何账号。</li>}
            </ul>
          )}
        </>
      )}
    </section>
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
  // 登录的管理员账号才有授权管理；null 是没登录或不是管理员。
  adminEmail: string | null;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// 设置页里素材库相关的三块：NAS 连接、AI 助手、网络。
export function MaterialSettingsSection({ section, notify, adminEmail }: MaterialSettingsSectionProps) {
  const settings = useMaterialSettings(notify, adminEmail);
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
  if (!settings.config) return null;
  return (
    <>
      <NasSettingsForm config={settings.config} busy={busy} onSubmit={settings.saveConfig} />
      {adminEmail && settings.config.hasPassword && settings.config.source === 'manual' && <NasGrantsPanel key={settings.savedCount} adminEmail={adminEmail} notify={notify} />}
    </>
  );
}
