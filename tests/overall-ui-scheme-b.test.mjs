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

test('scheme B makes global search scope explicit and de-emphasizes sidebar selection', () => {
  const appSource = readUiSource();
  const styles = readText('src', 'styles.css');

  assert.match(appSource, /<Sidebar[\s\S]+?isGlobalSearchActive=\{query\.trim\(\)\.length > 0\}/);
  assert.match(appSource, /<PromptList[\s\S]+?query=\{query\}/);
  assert.match(appSource, /className=\{`library-search-box \$\{query\.trim\(\) \? 'is-global-search' : ''\}`\}/);
  assert.match(appSource, /className="search-scope-chip"/);
  assert.match(appSource, /placeholder=\{`搜索全部\$\{libraryLabel\}`\}/);
  assert.match(appSource, /const normalizedQuery = query\.trim\(\);/);
  assert.match(appSource, /全局搜索：\{normalizedQuery\}/);
  assert.match(appSource, /搜索全部\$\{itemLabel\}，按相关度排序。左侧分类只保留位置上下文。/);
  assert.match(appSource, /search-context/);
  assert.match(appSource, /className="context-badge"/);
  assert.match(appSource, />原位置</);

  assert.match(styles, /--accent:\s*#2563eb;/);
  assert.match(styles, /--surface-quiet:\s*#f7f9fc;/);
  assert.match(styles, /\.search-scope-chip\s*\{/);
  assert.match(styles, /\.library-search-box\.is-global-search\s*\{/);
  assert.match(styles, /\.document-workbar\s*\{/);
  assert.match(styles, /\.category-item\.search-context\s*\{/);
  assert.match(styles, /\.context-badge\s*\{/);
  assert.match(styles, /\.full-prompt-card\s*\{[\s\S]+?border-bottom:\s*1px solid var\(--border\);/);
});
