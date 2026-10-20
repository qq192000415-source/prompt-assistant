import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import type { NasStatusController } from '../../materials/useNasStatus';

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// 离下次自动重连还有几秒，每秒走一次。顶部栏的 NAS 胶囊也用。
export function useSecondsUntil(iso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [iso]);
  return iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000)) : null;
}

// 设置页 NAS 一节的连接状态：绿点已连接、红点已断开（带自动重连倒计时、断开原因和「重新连接」），以及本机待上传的生成记录和上限提醒。
// 素材库、画布里看的是顶部栏的 NAS 胶囊（TopMenuBar.tsx）。
export function NasStatusBadge({ nas }: { nas: NasStatusController }) {
  const { status, reconnecting, reconnect } = nas;
  const seconds = useSecondsUntil(status?.state === 'disconnected' ? status.nextRetryAt : null);
  if (!status) return null;
  const { state, pending } = status;
  const label = state === 'connected' ? 'NAS 已连接' : state === 'disconnected' ? 'NAS 已断开' : 'NAS 还没连上过';
  const retry = state === 'disconnected' && !reconnecting && seconds !== null ? `，${seconds} 秒后自动重连` : '';
  const pendingText = pending.count
    ? state === 'connected'
      ? `本机有 ${pending.count} 条生成记录正在传上 NAS`
      : `${pending.count} 条生成记录（${formatBytes(pending.bytes)}）先存在本机，连上后自动传上去`
    : '';
  return (
    <div className={`nas-status is-${state}`} role="status" aria-live="polite">
      <span className="nas-status-line" title={status.error || undefined}>
        <span className="nas-status-dot" aria-hidden="true" />
        <strong>{label}</strong>
        {reconnecting ? <span>，正在连接…</span> : retry && <span>{retry}</span>}
      </span>
      {state !== 'connected' && (
        <Button className="button ghost compact" type="button" disabled={reconnecting} onClick={() => void reconnect()}>
          <RefreshCw size={13} className={reconnecting ? 'is-spinning' : ''} />
          重新连接
        </Button>
      )}
      {state === 'disconnected' && status.error && <p className="nas-status-detail">{status.error}</p>}
      {pendingText && <p className="nas-status-detail">{pendingText}</p>}
      {pending.overLimit && (
        <p className="nas-status-detail is-warning">本机暂存的生成记录超过 500MB 或放了 7 天以上，请尽快恢复 NAS 连接。传上去之前不会删。</p>
      )}
    </div>
  );
}
