// 文档文件的出入口：桌面版走主进程（electron/attachmentStore.cjs），网页版走这里。
// 网页版没有主进程，文件按 sha256 存在浏览器的 IndexedDB 里（相当于桌面版的本机目录），云端同步照旧由 useCloudSync 负责。
// 浏览器做不到的：把文件放进剪贴板、拖到微信、在文件夹里显示，所以「复制文件」「另存为」都改成下载。

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const STORE = 'files';

let database: Promise<IDBDatabase> | null = null;
const openDatabase = () =>
  (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('musebox-documents', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));

const inStore = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (byte) => byte.toString(16).padStart(2, '0')).join('');

const store = async (bytes: Uint8Array) => {
  const sha256 = await sha256Hex(bytes);
  await inStore('readwrite', (files) => files.put(bytes, sha256));
  return sha256;
};

const readBytes = async (sha: string) => {
  const bytes = await inStore<Uint8Array | undefined>('readonly', (files) => files.get(sha));
  if (!bytes) throw new Error('浏览器里没有这个文件，登录云同步后可以从云端取回');
  return bytes;
};

// 只有这几类在新标签页里直接看；HTML、SVG 这类能跑脚本的一律下载，不在本站点打开。
const VIEWABLE: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain;charset=utf-8',
  md: 'text/plain;charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
const viewableType = (name: string) => VIEWABLE[name.split('.').pop()?.toLowerCase() ?? ''];

const download = async (sha: string, name: string) => {
  const url = URL.createObjectURL(new Blob([(await readBytes(sha)) as BlobPart], { type: 'application/octet-stream' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const pickFiles = () =>
  new Promise<File[]>((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });

const webDocumentsApi: DesktopDocumentsApi = {
  async pickAndAdd() {
    const added: DesktopDocumentFile[] = [];
    const errors: Array<{ name: string; message: string }> = [];
    for (const file of await pickFiles()) {
      if (file.size > MAX_FILE_BYTES) {
        errors.push({ name: file.name, message: `“${file.name}”超过 50MB，不能存入文档库` });
        continue;
      }
      try {
        const sha256 = await store(new Uint8Array(await file.arrayBuffer()));
        added.push({ name: file.name, size: file.size, sha256, addedAt: new Date().toISOString() });
      } catch (error) {
        errors.push({ name: file.name, message: error instanceof Error ? error.message : '读取失败' });
      }
    }
    return { added, errors };
  },
  has: async (sha) => (await inStore<number>('readonly', (files) => files.count(sha))) > 0,
  readBytes,
  writeBytes: async (sha, bytes) => {
    if ((await sha256Hex(bytes)) !== sha) throw new Error('下载的文件校验不对，没有保存');
    await inStore('readwrite', (files) => files.put(bytes, sha));
  },
  readText: async (sha) => new TextDecoder().decode(await readBytes(sha)).replace(/^﻿/, ''),
  saveText: async (text) => {
    const bytes = new TextEncoder().encode(text);
    return { sha256: await store(bytes), size: bytes.length };
  },
  open: async (sha, name) => {
    const type = viewableType(name);
    if (!type) return download(sha, name);
    const url = URL.createObjectURL(new Blob([(await readBytes(sha)) as BlobPart], { type }));
    // 前面等过下载，浏览器可能当成弹窗拦掉，拦掉就改成下载。
    if (!window.open(url, '_blank')) await download(sha, name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  showInFolder: download,
  copyFile: download,
  // 网页版没有本机路径，指令后面只写文件名，文件另外下载后发送。
  sharePath: async (_sha, name) => name,
  saveAs: async (sha, name) => {
    await download(sha, name);
    return true;
  },
  startDrag: () => {},
};

export const isWebDocuments = !window.promptAssistantDesktop?.documents;
export const getDocumentsApi = () => window.promptAssistantDesktop?.documents ?? webDocumentsApi;
