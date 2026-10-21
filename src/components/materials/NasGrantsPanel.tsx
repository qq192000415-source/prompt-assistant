import { useEffect, useMemo, useState } from 'react';
import { Pencil, RefreshCw, Search } from 'lucide-react';
import { Button } from '../ui/button';
import { deleteNasGrant, listAppUsers, normalizeCloudEmail, saveApiRecommendation, saveAppUserNote, saveNasGrant, type AppUser } from '../../cloudSync';

// 授权管理（管理员）：列出所有注册过的账号和是否已授权 NAS，能授权、收回、写备注（姓名等）和标签。
// 授权的是管理员这台电脑上现在的连接；管理员改了连接保存后，已授权的账号会一起更新。
// 推荐 API 地址（1.14.1）：在每个账号的编辑里单独填（不授权 NAS 也能填），对方登录后提示把 API 配置的接口地址换成它。

type Filter = 'all' | 'granted' | 'ungranted';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'granted', label: '已授权' },
  { value: 'ungranted', label: '未授权' },
];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString('zh-CN') : '');
// 标签用逗号、顿号或空格分开。
const parseTags = (text: string) => text.split(/[,，、\s]+/).map((tag) => tag.trim()).filter(Boolean);

export function NasGrantsPanel({ adminEmail, notify }: { adminEmail: string; notify: (message: string) => void }) {
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState('');
  const [confirming, setConfirming] = useState('');
  const [editing, setEditing] = useState<{ email: string; note: string; tags: string; apiUrl: string } | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const self = normalizeCloudEmail(adminEmail);

  const reload = () =>
    listAppUsers().then(
      (list) => {
        setUsers(list);
        setLoadError('');
      },
      (error) => setLoadError(messageOf(error)),
    );
  useEffect(() => {
    void reload();
  }, []);

  const act = async (email: string, action: () => Promise<void>, done: string) => {
    setWorking(email);
    try {
      await action();
      notify(done);
      await reload();
    } catch (error) {
      notify(messageOf(error));
    } finally {
      setWorking('');
      setConfirming('');
    }
  };

  const grant = (email: string) =>
    act(
      email,
      async () => {
        const own = await window.promptAssistantDesktop!.materials!.revealConfig();
        await saveNasGrant({ email, baseUrl: own.baseUrl, username: own.username, password: own.password });
      },
      `已给 ${email} 开通 NAS 连接，对方下次启动或登录时自动连上`,
    );
  const revoke = (email: string) => act(email, () => deleteNasGrant(email), `已收回 ${email} 的 NAS 连接`);
  // 备注、标签和推荐 API 地址一起保存；地址没改就不碰那张表。
  const saveNote = (user: AppUser, note: string, tags: string, apiUrl: string) => {
    const url = apiUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      notify('推荐 API 地址要以 http:// 或 https:// 开头');
      return;
    }
    void act(
      user.email,
      async () => {
        await saveAppUserNote(user.email, note, parseTags(tags));
        if (url !== user.apiUrl) await saveApiRecommendation(user.email, url);
      },
      url !== user.apiUrl ? (url ? '已保存，对方下次登录或启动时会收到替换 API 地址的提示' : '已保存，不再给对方推荐 API 地址') : '备注已保存',
    ).then(() => setEditing(null));
  };

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () =>
      (users ?? []).filter(
        (user) =>
          (filter === 'all' || (filter === 'granted') === user.granted) &&
          words.every((word) => `${user.email}\n${user.note}\n${user.tags.join(' ')}`.toLowerCase().includes(word)),
      ),
    [users, filter, query],
  );
  const grantedCount = (users ?? []).filter((user) => user.granted).length;

  return (
    <section className="nas-grants" aria-labelledby="nas-grants-title">
      <div className="nas-grants-head">
        <div>
          <h3 id="nas-grants-title">授权管理</h3>
          {users && (
            <p className="nas-form-note">
              共 {users.length} 个账号 · 已授权 {grantedCount} · 未授权 {users.length - grantedCount}
            </p>
          )}
        </div>
        <Button className="icon-button" type="button" aria-label="刷新用户列表" title="刷新" onClick={() => void reload()}>
          <RefreshCw size={15} />
        </Button>
      </div>
      <p className="nas-form-note">授权的账号登录后自动连上这台电脑现在的 NAS 连接，看不到密码，素材放在自己邮箱命名的子文件夹里；收回后对方下次启动或登录时断开。大家共用同一个 NAS 用户，要彻底收回请在 NAS 上改密码。</p>

      {loadError ? (
        <p className="canvas-detail-error" role="alert">
          {loadError}
        </p>
      ) : users === null ? (
        <p className="nas-form-note">正在读取用户列表…</p>
      ) : (
        <>
          <div className="nas-grants-toolbar">
            <label className="materials-search">
              <Search size={14} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮箱、备注、标签" aria-label="搜索用户" />
            </label>
            <div className="canvas-segmented" role="radiogroup" aria-label="按授权状态筛">
              {FILTERS.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={filter === option.value} className={filter === option.value ? 'is-active' : ''} onClick={() => setFilter(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <ul className="nas-users">
            {shown.map((user) => (
              <li key={user.email} className={user.granted ? 'is-granted' : ''}>
                {editing?.email === user.email ? (
                  <form
                    className="nas-user-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveNote(user, editing.note, editing.tags, editing.apiUrl);
                    }}
                  >
                    <strong>{user.email}</strong>
                    <input autoFocus value={editing.note} onChange={(event) => setEditing({ ...editing, note: event.target.value })} placeholder="备注，比如姓名" aria-label="备注" />
                    <input value={editing.tags} onChange={(event) => setEditing({ ...editing, tags: event.target.value })} placeholder="标签，用逗号或空格分开" aria-label="标签" />
                    <input
                      className="is-wide"
                      value={editing.apiUrl}
                      onChange={(event) => setEditing({ ...editing, apiUrl: event.target.value })}
                      placeholder="推荐 API 地址，比如 https://example.com/v1；留空表示不推荐"
                      aria-label="推荐 API 地址"
                      title="对方登录后，如果 API 配置里的接口地址和这个不一样，会提示一键替换（只换地址，Key 和模型不变）"
                    />
                    <span className="nas-user-actions">
                      <Button className="button ghost compact" type="button" onClick={() => setEditing(null)}>
                        取消
                      </Button>
                      <Button className="button primary compact" type="submit" disabled={working === user.email}>
                        保存
                      </Button>
                    </span>
                  </form>
                ) : (
                  <>
                    <div className="nas-user-main">
                      <span className="nas-user-title">
                        {user.note && <strong>{user.note}</strong>}
                        <span className={user.note ? 'nas-user-email' : 'nas-user-email is-primary'}>{user.email}</span>
                        {user.email === self && <span className="nas-user-tag is-self">你自己</span>}
                        {user.tags.map((tag) => (
                          <span key={tag} className="nas-user-tag">
                            {tag}
                          </span>
                        ))}
                      </span>
                      <span className="nas-user-meta">
                        {user.registeredAt ? `注册 ${day(user.registeredAt)}` : '还没注册'}
                        {user.lastSignInAt ? ` · 最近登录 ${day(user.lastSignInAt)}` : ''}
                        {user.granted && user.grantedAt ? ` · 授权于 ${day(user.grantedAt)}` : ''}
                        {user.apiUrl ? ` · 推荐 API：${user.apiUrl}` : ''}
                      </span>
                    </div>
                    <span className={user.granted ? 'nas-user-status is-granted' : 'nas-user-status'}>{user.granted ? '已授权' : '未授权'}</span>
                    <span className="nas-user-actions">
                      <Button
                        className="icon-button compact-icon"
                        type="button"
                        aria-label={`编辑 ${user.email} 的备注`}
                        title="编辑备注、标签和推荐 API 地址"
                        onClick={() => setEditing({ email: user.email, note: user.note, tags: user.tags.join('，'), apiUrl: user.apiUrl })}
                      >
                        <Pencil size={14} />
                      </Button>
                      {user.email === self ? null : user.granted ? (
                        confirming === user.email ? (
                          <Button className="button danger compact" type="button" disabled={working === user.email} onClick={() => void revoke(user.email)}>
                            确认收回
                          </Button>
                        ) : (
                          <Button className="button ghost compact" type="button" onClick={() => setConfirming(user.email)}>
                            收回
                          </Button>
                        )
                      ) : (
                        <Button className="button primary compact" type="button" disabled={working === user.email} onClick={() => void grant(user.email)}>
                          授权
                        </Button>
                      )}
                    </span>
                  </>
                )}
              </li>
            ))}
            {shown.length === 0 && <li className="nas-form-note">没有符合条件的账号。</li>}
          </ul>

          <form
            className="nas-grants-add"
            onSubmit={(event) => {
              event.preventDefault();
              const email = normalizeCloudEmail(newEmail);
              if (email) void grant(email).then(() => setNewEmail(''));
            }}
          >
            <input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="对方还没注册？填登录邮箱先授权" aria-label="按邮箱授权" required />
            <Button className="button ghost" type="submit" disabled={Boolean(working)}>
              按邮箱授权
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
