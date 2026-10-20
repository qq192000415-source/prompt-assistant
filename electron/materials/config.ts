// 素材库的 NAS 连接设置：保存在本机 userData，密码用系统加密（safeStorage）。
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { accountConfig } from './accountFolder.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

export type PublicNasConfig = { baseUrl: string; username: string; hasPassword: boolean };

type StoredConfig = { baseUrl: string; username: string; password: string };

const configPath = (userDataDir: string) => path.join(userDataDir, 'materials-nas.json');

function readStored(userDataDir: string): StoredConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(userDataDir), 'utf8')) as Partial<StoredConfig>;
    if (typeof raw.baseUrl !== 'string' || typeof raw.username !== 'string') return null;
    return { baseUrl: raw.baseUrl, username: raw.username, password: typeof raw.password === 'string' ? raw.password : '' };
  } catch {
    return null;
  }
}

// 地址保存的是编码后的形式，给界面显示时还原成中文目录名。
const readableUrl = (url: string) => {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
};

export function getPublicConfig(userDataDir: string): PublicNasConfig {
  const stored = readStored(userDataDir);
  return { baseUrl: readableUrl(stored?.baseUrl ?? ''), username: stored?.username ?? '', hasPassword: Boolean(stored?.password) };
}

// 当前登录的云同步账号（邮箱），界面登录、切换、退出时告诉主进程；没登录是空串，素材库不读写 NAS。
let currentAccount = '';
export const getAccount = () => currentAccount;
export const setAccount = (email: string) => {
  currentAccount = email.trim();
};

// 素材库读写用的地址：专用文件夹下当前账号的子文件夹。account 传了就用它（画布任务用提交时的账号，中途切换账号也存回原处）。
export function loadConfig(userDataDir: string, account = currentAccount): DavConfig {
  const root = loadRootConfig(userDataDir);
  if (!account) throw new Error('请先登录云同步账号：素材库和画布按账号分开存放');
  return accountConfig(root, account);
}

// 专用文件夹本身（各账号子文件夹的上一级），只在连接 NAS 和准备账号文件夹时用。
export function loadRootConfig(userDataDir: string): DavConfig {
  const stored = readStored(userDataDir);
  if (!stored?.baseUrl || !stored.password) {
    throw new Error('还没有连接 NAS，请先在素材库里填写 NAS 连接');
  }
  return {
    baseUrl: stored.baseUrl,
    username: stored.username,
    password: safeStorage.decryptString(Buffer.from(stored.password, 'base64')),
  };
}

// 先连上 NAS、建好目录，再保存；password 为空表示沿用已保存的密码。
export async function saveConfig(userDataDir: string, input: { baseUrl: string; username: string; password?: string }) {
  const baseUrl = webdav.normalizeBaseUrl(input.baseUrl);
  const username = input.username.trim();
  if (!username) throw new Error('请填写 NAS 用户名');
  const password = input.password || (readStored(userDataDir)?.password ? loadRootConfig(userDataDir).password : '');
  if (!password) throw new Error('请填写 NAS 密码');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('这台电脑无法加密保存密码，没有保存 NAS 连接');
  }

  const config = { baseUrl, username, password };
  if (!(await webdav.exists(config, ''))) {
    throw new Error('NAS 上找不到这个文件夹，检查地址最后的文件夹名');
  }

  const stored: StoredConfig = { baseUrl, username, password: safeStorage.encryptString(password).toString('base64') };
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(stored, null, 2));
  return getPublicConfig(userDataDir);
}

