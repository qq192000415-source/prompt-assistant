import { useEffect, useState, type FormEvent } from 'react';
import { Copy, ImageDown, Trash2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { UNCATEGORIZED, normalizePromptText, uniqueTags, type MaterialGroup, type MaterialItem } from '../../materials/library';
import type { MaterialLibraryController } from '../../materials/useMaterialLibrary';
import { mediaSrc, previewSrc } from './MaterialLibraryView';

type Draft = { title: string; category: string; prompt: string; negativePrompt: string; tags: string };

const draftOf = (item: MaterialItem): Draft => ({
  title: item.title,
  category: item.category,
  prompt: item.prompt,
  negativePrompt: item.negativePrompt,
  tags: item.tags.join('，'),
});

const splitTags = (value: string) => value.split(/[,，、\n]/);

// 按保存时的规整规则比较，标签分隔符、首尾空白不同不算改动。
const normalizedDraft = (draft: Draft) =>
  JSON.stringify([
    draft.title.trim(),
    draft.category.trim() === UNCATEGORIZED ? '' : draft.category.trim(),
    normalizePromptText(draft.prompt),
    normalizePromptText(draft.negativePrompt),
    uniqueTags(splitTags(draft.tags)),
  ]);

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

type MaterialDetailDialogProps = {
  group: MaterialGroup;
  itemId: string;
  onSelectItem: (id: string) => void;
  categories: string[];
  controller: MaterialLibraryController;
  onCopyPrompt: (text: string) => void;
  onClose: () => void;
};

export function MaterialDetailDialog({ group, itemId, onSelectItem, categories, controller, onCopyPrompt, onClose }: MaterialDetailDialogProps) {
  const current = group.items.find((item) => item.id === itemId) ?? group.primary;
  const [draft, setDraft] = useState<Draft>(() => draftOf(group.primary));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dirty = normalizedDraft(draft) !== normalizedDraft(draftOf(group.primary));
  const busy = Boolean(controller.busy);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((previous) => ({ ...previous, [key]: event.target.value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    await controller.update(group.primary.id, {
      title: draft.title,
      category: draft.category,
      prompt: draft.prompt,
      negativePrompt: draft.negativePrompt,
      tags: splitTags(draft.tags),
    });
  };

  // 先切到同组下一张再删，否则删完后弹窗按旧 id 找不到组会直接关掉。
  const removeCurrent = async () => {
    const deletingId = current.id;
    const rest = group.items.filter((item) => item.id !== deletingId);
    if (rest.length) onSelectItem(rest[0].id);
    setConfirmingDelete(false);
    const removed = await controller.remove([deletingId]);
    if (!removed) {
      onSelectItem(deletingId);
    } else if (!rest.length) {
      onClose();
    }
  };

  const title = group.primary.title || group.primary.media.name;
  const dimensions = current.media.width && current.media.height ? `${current.media.width}×${current.media.height}` : '';

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="material-detail-title">
      <Button className="modal-backdrop" type="button" aria-label="关闭" onClick={onClose} />
      <section className="editor-panel material-detail">
        <div className="material-detail-media">
          {current.media.kind === 'video' ? (
            <video key={current.id} src={mediaSrc(current.media)} controls playsInline />
          ) : (
            <img key={current.id} src={mediaSrc(current.media)} alt={title} />
          )}
          {group.items.length > 1 && (
            <div className="material-detail-strip" role="tablist" aria-label="同组效果图">
              {group.items.map((item, index) => (
                <button
                  key={item.id}
                  className={item.id === current.id ? 'is-active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={item.id === current.id}
                  aria-label={`第 ${index + 1} 张`}
                  onClick={() => {
                    onSelectItem(item.id);
                    setConfirmingDelete(false);
                  }}
                >
                  {item.media.kind === 'video' ? <video src={`${mediaSrc(item.media)}#t=0.1`} preload="metadata" muted /> : <img src={previewSrc(item.media)} alt="" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <form className="material-detail-info" onSubmit={(event) => void save(event)}>
          <div className="editor-header">
            <div className="material-detail-heading">
              <h2 id="material-detail-title">{title}</h2>
              <span>
                {[current.media.name, dimensions, formatSize(current.media.size)].filter(Boolean).join(' · ')}
                {group.items.length > 1 ? ` · 同组 ${group.items.length} 张` : ''}
              </span>
            </div>
            <Button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
              <X size={18} />
            </Button>
          </div>

          <div className="material-detail-fields">
            <label className="field">
              标题
              <input value={draft.title} onChange={set('title')} placeholder={group.primary.media.name} />
            </label>
            <label className="field">
              分类
              <input value={draft.category} onChange={set('category')} placeholder={UNCATEGORIZED} list="material-categories" />
              <datalist id="material-categories">
                {categories.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <label className="field is-wide">
              <span className="material-field-label">
                正向提示词
                <Button className="button ghost compact" type="button" disabled={!draft.prompt.trim()} onClick={() => onCopyPrompt(draft.prompt)}>
                  <Copy size={13} />
                  复制
                </Button>
              </span>
              <textarea value={draft.prompt} onChange={set('prompt')} rows={5} />
            </label>
            <label className="field is-wide">
              <span className="material-field-label">
                负向提示词
                <Button
                  className="button ghost compact"
                  type="button"
                  disabled={!draft.negativePrompt.trim()}
                  onClick={() => onCopyPrompt(draft.negativePrompt)}
                >
                  <Copy size={13} />
                  复制
                </Button>
              </span>
              <textarea value={draft.negativePrompt} onChange={set('negativePrompt')} rows={3} />
            </label>
            <label className="field is-wide">
              标签
              <input value={draft.tags} onChange={set('tags')} placeholder="用逗号分隔，例如：人像，暖色" />
            </label>
          </div>
          {group.items.length > 1 && <p className="material-detail-note">改动会同时应用到同组的 {group.items.length} 张效果图。</p>}

          {confirmingDelete ? (
            <div className="material-detail-confirm" role="alert">
              <span>从 NAS 删除这{current.media.kind === 'video' ? '个视频' : '张图片'}和它的记录？</span>
              <Button className="button ghost compact" type="button" onClick={() => setConfirmingDelete(false)}>
                取消
              </Button>
              <Button className="button solid-danger compact" type="button" disabled={busy} onClick={() => void removeCurrent()}>
                删除
              </Button>
            </div>
          ) : (
            <div className="material-detail-actions">
              <Button className="button primary" type="submit" disabled={!dirty || busy}>
                {controller.busy === '正在保存…' ? '正在保存…' : '保存'}
              </Button>
              {current.media.kind === 'image' && (
                <Button className="button ghost" type="button" disabled={busy} onClick={() => void controller.copyImage(current.media)}>
                  <ImageDown size={15} />
                  复制图片
                </Button>
              )}
              <Button className="button ghost danger material-detail-delete" type="button" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={15} />
                {group.items.length > 1 ? '删除这张' : '删除'}
              </Button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
