import { useEffect, useRef, useState } from 'react';

// NAS 连接状态：打开时取一次，之后跟着主进程推来的变化走（electron/materials/nasMonitor.ts）。
export function useNasStatus() {
  const api = window.promptAssistantDesktop?.materials;
  const [status, setStatus] = useState<MaterialNasStatus | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!api) return undefined;
    void api.nasStatus().then(setStatus, () => undefined);
    return api.onNasStatus(setStatus);
  }, [api]);

  const reconnect = async () => {
    if (!api) return;
    setReconnecting(true);
    try {
      setStatus(await api.nasReconnect());
    } finally {
      setReconnecting(false);
    }
  };

  return { status, reconnecting, reconnect };
}

export type NasStatusController = ReturnType<typeof useNasStatus>;

// 从断开变成连上、或本机待上传的数量变了（存了新的、补传完了）时调用 onChange，用来重读 NAS 上的数据。
export function useNasRecovered(nas: NasStatusController, onChange: (reconnected: boolean) => void) {
  const state = nas.status?.state;
  const pending = nas.status?.pending.count ?? 0;
  const last = useRef({ state, pending });
  useEffect(() => {
    const previous = last.current;
    last.current = { state, pending };
    const reconnected = state === 'connected' && previous.state === 'disconnected';
    if (reconnected || (previous.state !== undefined && pending !== previous.pending)) onChange(reconnected);
  }, [state, pending]);
}
