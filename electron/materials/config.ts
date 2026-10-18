// 素材库的 NAS 连接设置：保存在本机 userData，密码用系统加密（safeStorage）。
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
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

export function loadConfig(userDataDir: string): DavConfig {
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
  const password = input.password || (readStored(userDataDir)?.password ? loadConfig(userDataDir).password : '');
  if (!password) throw new Error('请填写 NAS 密码');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('这台电脑无法加密保存密码，没有保存 NAS 连接');
  }

  const config = { baseUrl, username, password };
  if (!(await webdav.exists(config, ''))) {
    throw new Error('NAS 上找不到这个文件夹，检查地址最后的文件夹名');
  }
  await webdav.ensureFolder(config, 'media/');
  await webdav.ensureFolder(config, 'thumbs/');

  const stored: StoredConfig = { baseUrl, username, password: safeStorage.encryptString(password).toString('base64') };
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(stored, null, 2));
  return getPublicConfig(userDataDir);
}

