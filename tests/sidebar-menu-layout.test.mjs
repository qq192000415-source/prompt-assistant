import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const readText = (...segments) => readFileSync(join(rootDir, ...segments), 'utf8');

test('sidebar row action menu keeps category list scroll bounded', () => {
  const appSource = readText('src', 'App.tsx');
  const styles = readText('src', 'styles.css');
  const categoryItemSource = appSource.match(/function CategoryNavItem[\s\S]+?type SubcategoryNavItemProps/)?.[0] ?? '';
  const promptTreeItemSource = appSource.match(/function PromptTreeItem[\s\S]+?type TopMenuBarProps/)?.[0] ?? '';

  assert.doesNotMatch(styles, /\.categories:has\(\.row-action-menu\)/);
  assert.match(styles, /\.categories\s*\{[\s\S]+?overflow:\s*auto;/);
  assert.match(styles, /\.row-action-menu\s*\{[\s\S]+?position:\s*fixed;/);
  assert.match(appSource, /type RowActionMenuPosition = \{/);
  assert.match(categoryItemSource, /style=\{\{ top: actionMenuPosition\.top, left: actionMenuPosition\.left \}\}/);
  assert.match(promptTreeItemSource, /style=\{\{ top: actionMenuPosition\.top, left: actionMenuPosition\.left \}\}/);
});
