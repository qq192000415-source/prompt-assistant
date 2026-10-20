// 素材库的 NAS 连接设置：保存在本机 userData，密码用系统加密（safeStorage）。
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { accountConfig } from './accountFolder.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

// source：manual 是这台电脑上自己填的；grant 是管理员授权、登录后自动填的（1.9.7），授权收回时会删掉，也不给看密码。
export type NasConfigSource = 'manual' | 'grant';
export type PublicNasConfig = { baseUrl: string; username: string; hasPassword: boolean; source: NasConfigSource };

type StoredConfig = { baseUrl: string; username: string; password: string; source: NasConfigSource };

const configPath = (userDataDir: string) => path.join(userDataDir, 'materials-nas.json');

function readStored(userDataDir: string): StoredConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(userDataDir), 'utf8')) as Partial<StoredConfig>;
    if (typeof raw.baseUrl !== 'string' || typeof raw.username !== 'string') return null;
    return { baseUrl: raw.baseUrl, username: raw.username, password: typeof raw.password === 'string' ? raw.password : '', source: raw.source === 'grant' ? 'grant' : 'manual' };
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
  return { baseUrl: readableUrl(stored?.baseUrl ?? ''), username: stored?.username ?? '', hasPassword: Boolean(stored?.password), source: stored?.source ?? 'manual' };
}

// 设置页点眼睛看明文、管理员授权时取自己的连接用。授权来的连接不给看密码。
export function revealConfig(userDataDir: string): DavConfig {
  if (readStored(userDataDir)?.source === 'grant') throw new Error('这是管理员授权的 NAS 连接，不显示密码');
  return { ...loadRootConfig(userDataDir), baseUrl: readableUrl(loadRootConfig(userDataDir).baseUrl) };
}

// 登录后按授权表同步：有授权且这台电脑没填过自己的 NAS（或之前就是授权来的）就连上；授权没了就删掉授权来的连接。
// 自己填的连接一律不动。own 是管理员自己那一行：存成 manual，换电脑后照样能看、能改、能授权给别人。
export async function applyGrant(userDataDir: string, grant: { baseUrl: string; username: string; password: string } | null, own: boolean) {
  const stored = readStored(userDataDir);
  if (!grant) {
    if (stored?.source !== 'grant') return { changed: false };
    fs.rmSync(configPath(userDataDir), { force: true });
    return { changed: true };
  }
  if (stored && stored.source !== 'grant') return { changed: false };
  if (stored && webdav.normalizeBaseUrl(grant.baseUrl) === stored.baseUrl && grant.username === stored.username && grant.password === loadRootConfig(userDataDir).password && !own) {
    return { changed: false };
  }
  await saveConfig(userDataDir, grant, own ? 'manual' : 'grant');
  return { changed: true };
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

// 先连上 NAS 再保存；password 为空表示沿用已保存的密码。授权来的连接换成自己的 NAS 时必须重新填密码，不沿用管理员的。
export async function saveConfig(userDataDir: string, input: { baseUrl: string; username: string; password?: string }, source: NasConfigSource = 'manual') {
  const baseUrl = webdav.normalizeBaseUrl(input.baseUrl);
  const username = input.username.trim();
  if (!username) throw new Error('请填写 NAS 用户名');
  const previous = readStored(userDataDir);
  const reusable = previous?.password && (previous.source === source || source === 'grant');
  const password = input.password || (reusable ? loadRootConfig(userDataDir).password : '');
  if (!password) throw new Error('请填写 NAS 密码');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('这台电脑无法加密保存密码，没有保存 NAS 连接');
  }

  const config = { baseUrl, username, password };
  if (!(await webdav.exists(config, ''))) {
    throw new Error('NAS 上找不到这个文件夹，检查地址最后的文件夹名');
  }

  const stored: StoredConfig = { baseUrl, username, password: safeStorage.encryptString(password).toString('base64'), source };
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(configPath(userDataDir), JSON.stringify(stored, null, 2));
  return getPublicConfig(userDataDir);
}

