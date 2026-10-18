// library.json 的读和加锁读改写，只依赖 WebDAV，Node 测试可以直接加载。
import { emptyLibrary, normalizeLibrary, type MaterialLibrary } from '../../src/materials/library.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

export const LIBRARY_FILE = 'library.json';
const LOCK_SECONDS = 30;
// 第 n 次重试前等 0.5n 秒，最多等约 27 秒，超过就明确报错，不硬写。
const LOCK_RETRIES = 10;

function parseLibrary(text: string | null) {
  if (text === null || !text.trim()) return { library: emptyLibrary(), dropped: 0 };
  try {
    return normalizeLibrary(JSON.parse(text));
  } catch {
    throw new Error('NAS 上的 library.json 不是有效的 JSON，已停止，避免覆盖。请先检查这个文件');
  }
}

export async function readLibrary(config: DavConfig) {
  return parseLibrary(await webdav.readText(config, LIBRARY_FILE));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 加锁 → 读 NAS 上最新的 → 改 → 写回 → 解锁。fnOS 的 WebDAV 不认 If-Match，所以只能靠 LOCK 防止两台电脑互相覆盖。
export async function mutateLibrary<T>(
  config: DavConfig,
  change: (library: MaterialLibrary) => { library: MaterialLibrary; result: T },
): Promise<{ library: MaterialLibrary; dropped: number; result: T }> {
  let token: string | null = null;
  for (let attempt = 0; attempt < LOCK_RETRIES && !token; attempt += 1) {
    if (attempt > 0) await wait(500 * attempt);
    token = await webdav.lock(config, LIBRARY_FILE, LOCK_SECONDS);
  }
  if (!token) {
    throw new Error('另一台电脑正在修改素材库，等了 27 秒还没结束，这次改动没有保存，请稍后再试');
  }

  try {
    const { library, dropped } = parseLibrary(await webdav.readText(config, LIBRARY_FILE));
    const changed = change(library);
    await webdav.put(config, LIBRARY_FILE, JSON.stringify(changed.library, null, 2), {
      If: `(${token})`,
      'Content-Type': 'application/json; charset=utf-8',
    });
    return { library: changed.library, dropped, result: changed.result };
  } finally {
    await webdav.unlock(config, LIBRARY_FILE, token).catch((error) => {
      console.warn('素材库解锁失败，服务器会在 30 秒后自动释放', error);
    });
  }
}
