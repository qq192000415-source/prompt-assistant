import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '../ui/button';
import type { MaterialLibraryController } from '../../materials/useMaterialLibrary';
import { copyToClipboard } from '../../promptUtils';

// 画布模板栏：盖在窗口右边的宽侧栏（照 iLab CONJURE），模板按分类分组铺成卡片，点卡片看详情，可复制、插入、替换。
// 模板存在 NAS 的 canvas-templates.json，和提示词库分开；列表由画布持有，这里改完通过 onChange 交回去。

type View = { mode: 'list' } | { mode: 'detail'; id: string } | { mode: 'edit'; id: string | null; title: string; category: string; content: string };

type Props = {
  controller: MaterialLibraryController;
  templates: MaterialCanvasTemplate[] | null;
  loadError: string;
  // 打开时直接新建（「存为模板」），内容是当前提示词。
  newContent: string | null;
  onChange: (templates: MaterialCanvasTemplate[]) => void;
  onUse: (template: MaterialCanvasTemplate, how: 'insert' | 'replace') => void;
  onClose: () => void;
};

const newDraft = (content: string): View => ({ mode: 'edit', id: null, title: content.trim().split(/\r?\n/)[0].slice(0, 24), category: '', content });

export function CanvasTemplatePanel({ controller, templates, loadError, newContent, onChange, onUse, onClose }: Props) {
  const [view, setView] = useState<View>(newContent === null ? { mode: 'list' } : newDraft(newContent));
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const list = templates ?? [];
  const categories = useMemo(() => [...new Set(list.map((entry) => entry.category))], [list]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matched = list.filter((entry) => (!category || entry.category === category) && words.every((word) => `${entry.title}\n${entry.category}\n${entry.content}`.toLowerCase().includes(word)));
  // 选「全部」且没搜索时按分类分组，否则只铺一组。
  const groups = !category && !words.length ? categories.map((name) => ({ name, items: matched.filter((entry) => entry.category === name) })) : [{ name: '', items: matched }];
  const current = view.mode === 'detail' ? list.find((entry) => entry.id === view.id) : undefined;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const save = async () => {
    if (view.mode !== 'edit') return;
    const saved = await controller.canvasTemplateSave({ id: view.id ?? undefined, title: view.title, content: view.content, category: view.category });
    if (!saved) return;
    onChange(saved.templates.templates);
    setView({ mode: 'detail', id: saved.result.id });
  };

  const remove = async (id: string) => {
    const result = await controller.canvasTemplateDelete(id);
    if (!result) return;
    onChange(result.templates.templates);
    setConfirmDelete(false);
    setView({ mode: 'list' });
  };

  const copy = async (content: string) => {
    try {
      await copyToClipboard(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const body = () => {
    if (templates === null) return <p className="nas-form-note">{loadError || '正在读取模板…'}</p>;
    if (view.mode === 'edit') {
      const set = (patch: Partial<Omit<Extract<View, { mode: 'edit' }>, 'mode'>>) => setView({ ...view, ...patch });
      return (
        <form
          className="canvas-template-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <span>标题</span>
            <input value={view.title} onChange={(event) => set({ title: event.target.value })} placeholder="不填就用内容的第一行" />
          </label>
          <label className="field">
            <span>分类</span>
            <input value={view.category} list="canvas-template-categories" onChange={(event) => set({ category: event.target.value })} placeholder="选已有的或输入新的，不填归到「未分类」" />
            <datalist id="canvas-template-categories">
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className="field canvas-template-form-content">
            <span>内容</span>
            <textarea autoFocus value={view.content} onChange={(event) => set({ content: event.target.value })} placeholder="生图用的提示词" />
          </label>
          <div className="canvas-template-actions">
            <Button className="button ghost" type="button" onClick={() => setView(view.id ? { mode: 'detail', id: view.id } : { mode: 'list' })}>
              取消
            </Button>
            <Button className="button primary" type="submit" disabled={!view.content.trim() || Boolean(controller.busy)}>
              保存
            </Button>
          </div>
        </form>
      );
    }
    if (current) {
      return (
        <div className="canvas-template-detail">
          <div className="canvas-template-actions">
            <Button className="button ghost" type="button" onClick={() => setView({ mode: 'list' })}>
              <ArrowLeft size={14} />
              返回
            </Button>
            <span className="canvas-template-actions-end">
              {confirmDelete ? (
                <Button className="button danger" type="button" disabled={Boolean(controller.busy)} onClick={() => void remove(current.id)}>
                  确认删除
                </Button>
              ) : (
                <Button className="icon-button" type="button" aria-label="删除模板" title="删除模板" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} />
                </Button>
              )}
              <Button className="button primary" type="button" onClick={() => setView({ mode: 'edit', id: current.id, title: current.title, category: current.category, content: current.content })}>
                <Pencil size={14} />
                编辑
              </Button>
            </span>
          </div>
          <h3>{current.title}</h3>
          <p className="canvas-template-meta">
            {current.category} · 用过 {current.useCount} 次
          </p>
          <pre className="canvas-template-content">{current.content}</pre>
          <div className="canvas-template-actions">
            <span className="canvas-template-actions-start">
              <Button className="button ghost" type="button" onClick={() => void copy(current.content)}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? '已复制' : '复制'}
              </Button>
              <Button className="button ghost" type="button" title="插到提示词框的光标处" onClick={() => onUse(current, 'insert')}>
                插入
              </Button>
            </span>
            <Button className="button primary" type="button" title="用这条换掉正向提示词" onClick={() => onUse(current, 'replace')}>
              替换
            </Button>
          </div>
        </div>
      );
    }
    if (!list.length) return <p className="nas-form-note">还没有画布模板。写好提示词后点提示词框上的「存为模板」，或点「新建」。</p>;
    if (!matched.length) return <p className="nas-form-note">没有匹配的模板。</p>;
    return groups.map((group) => (
      <section key={group.name || '全部'} className="canvas-template-group" aria-label={group.name || '模板'}>
        {group.name && (
          <h3>
            {group.name} <span>· {group.items.length}</span>
          </h3>
        )}
        <ul className="canvas-template-cards">
          {group.items.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setView({ mode: 'detail', id: entry.id });
                }}
              >
                <strong>{entry.title}</strong>
                <span className="canvas-template-preview">{entry.content}</span>
                <span className="canvas-template-card-foot">
                  <span>{entry.category}</span>
                  <span>{entry.useCount} 次</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ));
  };

  return (
    <div className="modal-shell canvas-template-shell" role="dialog" aria-modal="true" aria-label="画布模板">
      <Button className="modal-backdrop" type="button" aria-label="关闭模板" onClick={onClose} />
      <aside className="canvas-template-drawer">
        <div className="canvas-template-head">
          <div>
            <h2>提示词模板</h2>
            <p>{templates === null ? '存在 NAS 上，和提示词库分开' : `${list.length} 个可用模板`}</p>
          </div>
          <Button className="icon-button" type="button" aria-label="关闭模板" onClick={onClose}>
            <X size={17} />
          </Button>
        </div>
        {templates !== null && view.mode === 'list' && (
            <>
              <div className="canvas-template-toolbar">
                <label className="materials-search">
                  <Search size={14} aria-hidden="true" />
                  <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板、分类、内容" aria-label="搜索模板" />
                </label>
                <Button className="button ghost" type="button" onClick={() => setView(newDraft(''))}>
                  <Plus size={14} />
                  新建
                </Button>
              </div>
              {categories.length > 0 && (
                <div className="canvas-template-chips" role="radiogroup" aria-label="按分类筛">
                  {['', ...categories].map((name) => (
                    <button key={name || '全部'} type="button" role="radio" aria-checked={category === name} className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>
                      {name || '全部'} {name ? list.filter((entry) => entry.category === name).length : list.length}
                    </button>
                  ))}
                </div>
              )}
            </>
        )}
        <div className="canvas-template-body">{body()}</div>
      </aside>
    </div>
  );
}
