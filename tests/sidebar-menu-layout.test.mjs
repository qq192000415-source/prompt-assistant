import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const readText = (...segments) => readFileSync(join(rootDir, ...segments), 'utf8');
// 界面源码分在 App.tsx 和 src/components/ 下；按“整个界面里有没有”来断言，不绑定具体文件。
const readUiSource = () =>
  [
    readText('src', 'App.tsx'),
    ...readdirSync(join(rootDir, 'src', 'components'))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => readText('src', 'components', name)),
  ].join('\n');

test('sidebar row action menu keeps category list scroll bounded', () => {
  const appSource = readUiSource();
  const styles = readText('src', 'styles.css');
  const categoryItemSource = appSource.match(/function CategoryNavItem[\s\S]+?type SubcategoryNavItemProps/)?.[0] ?? '';
  const promptTreeItemSource = readText('src', 'components', 'Sidebar.tsx').match(/function PromptTreeItem[\s\S]+$/)?.[0] ?? '';

  assert.doesNotMatch(styles, /\.categories:has\(\.row-action-menu\)/);
  assert.match(styles, /\.categories\s*\{[\s\S]+?overflow:\s*auto;/);
  assert.match(styles, /\.row-action-menu\s*\{[\s\S]+?position:\s*fixed;/);
  assert.match(appSource, /type RowActionMenuPosition = \{/);
  assert.match(categoryItemSource, /style=\{\{ top: actionMenuPosition\.top, left: actionMenuPosition\.left \}\}/);
  assert.match(promptTreeItemSource, /style=\{\{ top: actionMenuPosition\.top, left: actionMenuPosition\.left \}\}/);
});
