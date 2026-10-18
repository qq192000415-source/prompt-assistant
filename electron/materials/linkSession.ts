// 抓取分享链接专用的网络会话。代理设置只作用在这里，不影响 Supabase 同步、检查更新和连接 NAS。
import { session, type Session } from 'electron';

let cached: Session | null = null;

export function linkSession(): Session {
  cached ??= session.fromPartition('persist:materials-links');
  return cached;
}

// 移植来的 SuYan 抓取代码调用的是 electron 的 net.fetch，这里给它一个同样用法、但走专用会话的版本。
export const net = {
  fetch: (input: string, init?: RequestInit) => linkSession().fetch(input, init),
};
