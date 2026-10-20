// NAS 连接状态：所有 NAS 请求的结果都报到这里（webdav.ts 的 dav()）。连不上就按 15、30、60 秒的间隔自动试连，
// 之后每 60 秒一次，直到连上；「重新连接」立刻试一次。不依赖 Electron，Node 测试可直接加载。
export type NasState = 'unknown' | 'connected' | 'disconnected';
export type NasMonitorStatus = { state: NasState; error: string; nextRetryAt: string | null };

export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000];

type MonitorOptions = {
  // 试连一次：请求结果由 dav() 报回来，这里只管发出去，出错不用处理。
  probe: () => Promise<unknown>;
  onChange: (status: NasMonitorStatus, previous: NasState) => void;
  delays?: number[];
};

export function createNasMonitor({ probe, onChange, delays = RETRY_DELAYS_MS }: MonitorOptions) {
  let status: NasMonitorStatus = { state: 'unknown', error: '', nextRetryAt: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let probing: Promise<void> | null = null;

  const set = (next: NasMonitorStatus) => {
    const previous = status;
    status = next;
    if (next.state !== previous.state || next.error !== previous.error || next.nextRetryAt !== previous.nextRetryAt) onChange(status, previous.state);
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    const delay = delays[Math.min(attempt, delays.length - 1)];
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      void tryNow();
    }, delay);
    // 计时器不拖住进程退出。
    timer.unref?.();
    return new Date(Date.now() + delay).toISOString();
  };

  function report(ok: boolean, error = '') {
    if (ok) {
      if (status.state === 'connected') return;
      if (timer) clearTimeout(timer);
      timer = null;
      attempt = 0;
      set({ state: 'connected', error: '', nextRetryAt: null });
      return;
    }
    // 已经在等下一次试连：只更新原因，不重排时间。
    if (status.state === 'disconnected' && timer) {
      set({ ...status, error });
      return;
    }
    set({ state: 'disconnected', error, nextRetryAt: schedule() });
  }

  async function tryNow() {
    probing ??= probe()
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        probing = null;
      });
    await probing;
    // 试连没走到 NAS（比如还没填连接）就不会有报告，照样排下一次。
    if (status.state === 'disconnected' && !timer) set({ ...status, nextRetryAt: schedule() });
    return status;
  }

  return {
    report,
    status: () => status,
    reconnect: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      return tryNow();
    },
  };
}
