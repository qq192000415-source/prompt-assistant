// 设置 › 云同步 › 修改密码（1.17.1）：记得当前密码的自己改；忘了的联系管理员重置（授权管理里）。
// 设置页整个是一个 <form>，这里不能再套 form（嵌套的 form 会被浏览器去掉，点按钮提交的是外层、整页刷新），用按钮和回车键自己提交。
import { useState, type KeyboardEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from './ui/button';
import { changeOwnPassword } from '../cloudSync';
import { loadRememberedCloudLogin, saveRememberedCloudLogin } from '../localState';

export function ChangePasswordForm({ email, notify }: { email: string; notify: (message: string) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (next.length < 6) return setError('新密码至少 6 位');
    if (next !== again) return setError('两次输入的新密码不一样');
    if (next === current) return setError('新密码不能和当前密码一样');
    setBusy(true);
    setError('');
    try {
      await changeOwnPassword(email, current, next);
      // 记住了账号密码的，换成新密码，下次打开登录框不会填旧的
      const remembered = loadRememberedCloudLogin();
      if (remembered.email.trim().toLowerCase() === email.toLowerCase() && remembered.password) saveRememberedCloudLogin(remembered.email, next);
      setCurrent('');
      setNext('');
      setAgain('');
      notify('密码已修改，下次登录用新密码；其他电脑上的登录已退出');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const type = shown ? 'text' : 'password';
  return (
    <section className="settings-section" aria-labelledby="change-password-title">
      <div className="settings-section-title">
        <div>
          <h3 id="change-password-title">修改密码</h3>
          <p>记得当前密码就在这里改；忘记密码请联系管理员重置。管理员能看到你在灵匣的密码，请不要用和其他网站相同的密码。</p>
        </div>
        <Button className="icon-button" type="button" aria-label={shown ? '隐藏密码' : '显示密码'} title={shown ? '隐藏密码' : '显示密码'} onClick={() => setShown(!shown)}>
          {shown ? <EyeOff size={16} /> : <Eye size={16} />}
        </Button>
      </div>
      <div
        className="change-password-form"
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (!busy && current && next && again) void submit();
        }}
      >
        <label className="field">
          <span>当前密码</span>
          <input type={type} value={current} autoComplete="current-password" onChange={(event) => setCurrent(event.target.value)} />
        </label>
        <label className="field">
          <span>新密码</span>
          <input type={type} value={next} autoComplete="new-password" placeholder="至少 6 位" onChange={(event) => setNext(event.target.value)} />
        </label>
        <label className="field">
          <span>再输一次新密码</span>
          <input type={type} value={again} autoComplete="new-password" onChange={(event) => setAgain(event.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-header-actions">
          <Button className="button primary small-button" type="button" disabled={busy || !current || !next || !again} onClick={() => void submit()}>
            {busy ? '正在修改…' : '修改密码'}
          </Button>
        </div>
      </div>
    </section>
  );
}
