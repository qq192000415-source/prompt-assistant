// 素材库按云同步账号分开（1.9.6）：NAS 专用文件夹下每个账号一个子文件夹，用登录邮箱命名，素材、缩略图、
// 画布生成记录、画布模板都在里面。所有人共用一个 NAS 用户，所以这只是软件里互相看不到，不是 NAS 权限隔离。
// 不依赖 Electron，Node 测试可直接加载。
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

// 以前直接放在专用文件夹根下的东西，管理员账号第一次打开时整体搬进自己的子文件夹。
export const LEGACY_ENTRIES = ['library.json', 'media/', 'thumbs/', 'canvas-history/', 'canvas-templates.json'];

export const accountFolderName = (email: string) => email.trim().toLowerCase();

export const accountConfig = (root: DavConfig, email: string): DavConfig => ({
  ...root,
  baseUrl: webdav.davUrl(root, `${accountFolderName(email)}/`),
});

// 建好账号子文件夹；adoptLegacy 时先把根下的旧数据搬进来（账号里已有 library.json 就不搬），返回搬了哪些。
// 搬放在建 media/、thumbs/ 之前，否则目标已存在，MOVE 不覆盖会失败。
export async function prepareAccountFolder(root: DavConfig, email: string, adoptLegacy: boolean): Promise<string[]> {
  const folder = accountFolderName(email);
  if (!folder) throw new Error('登录账号没有邮箱，无法确定素材库的文件夹');
  await webdav.ensureFolder(root, `${folder}/`);
  const moved: string[] = [];
  if (adoptLegacy && !(await webdav.exists(root, `${folder}/library.json`))) {
    for (const entry of LEGACY_ENTRIES) {
      if (!(await webdav.exists(root, entry))) continue;
      try {
        await webdav.move(root, entry, `${folder}/${entry}`);
      } catch (error) {
        const done = moved.length ? `已搬过去的：${moved.join('、')}；` : '';
        throw new Error(`把旧素材搬进 ${folder}/ 时 ${entry} 没搬成（${error instanceof Error ? error.message : error}）。${done}其余还在原处，没有删除任何文件`);
      }
      moved.push(entry);
    }
  }
  const config = accountConfig(root, email);
  await webdav.ensureFolder(config, 'media/');
  await webdav.ensureFolder(config, 'thumbs/');
  return moved;
}
