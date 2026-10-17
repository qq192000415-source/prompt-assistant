import { useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, Files, FileText, FolderOpen, Heart, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { toast as pushToast } from 'sonner';
import { formatDate, formatFileSize, isMarkdownDocument, isTextDocument } from '../promptUtils';
import type { DocumentFile, PromptItem } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

function MarkdownView({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

type DocumentInstructionProps = {
  fileName: string;
  fileText: string | null;
  instruction: string;
  ready: boolean;
  onCopy: (content: string, message?: string) => void;
  onCopyFile: () => void;
  onGetSharePath: () => Promise<string>;
  onSave: (content: string) => void;
};

// 指令和文件一起给 AI：
// - .md/.txt：一次复制“指令 + 文件全文”，聊天窗口、编辑器、终端粘贴都完整。
// - 其他格式：剪贴板同时放文件和文字时，Chromium 系软件只收文件、丢掉文字，所以分两步：
//   ① 复制“指令 + 文件路径”（终端 AI 到这一步就够了），② 再复制文件。
function DocumentInstruction({
  fileName,
  fileText,
  instruction,
  ready,
  onCopy,
  onCopyFile,
  onGetSharePath,
  onSave,
}: DocumentInstructionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(instruction);
  const [awaitingFile, setAwaitingFile] = useState(false);

  useEffect(() => {
    if (!awaitingFile) return;
    const timer = window.setTimeout(() => setAwaitingFile(false), 60_000);
    return () => window.clearTimeout(timer);
  }, [awaitingFile]);

  const copyInstructionWithFile = async () => {
    if (fileText !== null) {
      onCopy(
        `${instruction}\n\n---------- ${fileName} ----------\n${fileText}`,
        '指令和文件内容已一起复制，粘贴到 AI 对话、编辑器或终端都可以',
      );
      return;
    }

    try {
      onCopy(
        `${instruction}\n\n文件：${await onGetSharePath()}`,
        '① 指令已复制（终端里的 AI 粘贴这一步就够了）。聊天窗口粘贴后，再点「② 复制文件」',
      );
      setAwaitingFile(true);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : '复制失败');
    }
  };

  const startEdit = () => {
    setDraft(instruction);
    setEditing(true);
  };

  const save = () => {
    onSave(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="document-instruction is-editing">
        <span className="document-instruction-label">配套指令</span>
        <Textarea
          autoFocus
          className="document-instruction-editor"
          placeholder="比如：请按这份规范审查我的项目代码，列出不符合的地方。"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              save();
            }
          }}
        />
        <div className="inline-edit-actions">
          <Button className="button ghost compact" type="button" onClick={() => setEditing(false)}>
            取消
          </Button>
          <Button className="button primary compact" type="button" onClick={save}>
            保存
          </Button>
        </div>
      </div>
    );
  }

  if (!instruction) {
    return (
      <button className="document-instruction-empty" type="button" onClick={startEdit}>
        <Plus size={15} />
        添加配套指令（把文件发给 AI 时一起用）
      </button>
    );
  }

  return (
    <div className="document-instruction">
      <div className="document-instruction-head">
        <span className="document-instruction-label">配套指令</span>
        <div className="document-instruction-actions">
          {awaitingFile ? (
            <Button
              className="button primary compact is-next-step"
              type="button"
              disabled={!ready}
              onClick={() => {
                setAwaitingFile(false);
                onCopyFile();
              }}
            >
              <Copy size={15} />
              ② 复制文件
            </Button>
          ) : (
            <Button
              className="button primary compact"
              type="button"
              disabled={!ready}
              title={fileText !== null ? '一次复制指令和文件全文' : '分两步：先复制指令，再复制文件'}
              onClick={() => void copyInstructionWithFile()}
            >
              <Files size={15} />
              {fileText !== null ? '复制指令+内容' : '复制指令+文件'}
            </Button>
          )}
          <Button className="button ghost compact" type="button" onClick={() => onCopy(instruction)}>
            <Copy size={15} />
            复制指令
          </Button>
          <Button className="icon-button" type="button" title="编辑配套指令" onClick={startEdit}>
            <Pencil size={15} />
          </Button>
        </div>
      </div>
      <p className="document-instruction-text" onDoubleClick={startEdit} title="双击编辑">
        {instruction}
      </p>
    </div>
  );
}

type DocumentViewProps = {
  item: PromptItem;
  onCopyFile: (item: PromptItem) => Promise<void>;
  onCopyText: (id: string, content: string, message?: string) => Promise<void>;
  onDelete: (id: string) => void;
  onEnsureLocal: (file: DocumentFile) => Promise<void>;
  onSaveInstruction: (id: string, instruction: string) => void;
  onSaveText: (item: PromptItem, text: string) => Promise<boolean>;
  onToggleFavorite: (id: string) => void;
};

// 文档卡片：主要动作是把文件发出去（复制文件、拖出去），其次是复制文字、打开、另存为。
export function DocumentView({
  item,
  onCopyFile,
  onCopyText,
  onDelete,
  onEnsureLocal,
  onSaveInstruction,
  onSaveText,
  onToggleFavorite,
}: DocumentViewProps) {
  const file = item.file;
  const api = window.promptAssistantDesktop?.documents;
  const [status, setStatus] = useState<'checking' | 'ready' | 'missing'>('checking');
  const [problem, setProblem] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const isText = file ? isTextDocument(file.name) : false;

  useEffect(() => {
    if (!file) return;
    let canceled = false;
    setStatus('checking');

    void onEnsureLocal(file)
      .then(async () => {
        const loadedText = isText && api ? await api.readText(file.sha256) : null;
        if (canceled) return;
        setText(loadedText);
        setStatus('ready');
      })
      .catch((error) => {
        if (canceled) return;
        setProblem(error instanceof Error ? error.message : '文件不可用');
        setStatus('missing');
      });

    return () => {
      canceled = true;
    };
  }, [file?.sha256, attempt]);

  if (!file) return null;

  const ready = status === 'ready' && Boolean(api);
  const canEdit = ready && text !== null;
  const startEdit = () => {
    if (canEdit) setDraft(text.replace(/\r\n/g, '\n'));
  };
  // 输入框里换行统一是 \n；原文件用 \r\n 的，保存时换回去，不改动文件的换行风格。
  const saveEdit = async () => {
    if (draft === null || text === null) return;
    const next = text.includes('\r\n') ? draft.replace(/\n/g, '\r\n') : draft;
    if (next === text || (await onSaveText(item, next))) setDraft(null);
  };
  const runFileAction = async (action: () => Promise<unknown>, failMessage: string) => {
    try {
      await action();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : failMessage);
    }
  };

  return (
    <article className="full-prompt-card document-card">
      <header className="full-prompt-header">
        <div
          className={`full-prompt-title document-title ${ready ? 'is-draggable' : ''}`}
          draggable={ready}
          title={ready ? '拖到微信、QQ、邮件或文件夹里即可发送' : undefined}
          onDragStart={(event) => {
            event.preventDefault();
            api?.startDrag(file.sha256, file.name);
          }}
        >
          <FileText size={18} aria-hidden="true" />
          <div>
            <h2>{item.title}</h2>
            <span className="document-meta">
              {file.name} · {formatFileSize(file.size)} · {formatDate(file.addedAt)}
            </span>
          </div>
        </div>
        <div className="preview-actions">
          <Button className="button primary compact" type="button" disabled={!ready} onClick={() => void onCopyFile(item)}>
            <Copy size={16} />
            复制文件
          </Button>
          {isText && (
            <Button
              className="button ghost compact"
              type="button"
              disabled={!ready || text === null}
              onClick={() => void onCopyText(item.id, text ?? '')}
            >
              <FileText size={16} />
              复制内容
            </Button>
          )}
          {isText && (
            <Button className="button ghost compact" type="button" disabled={!canEdit || draft !== null} onClick={startEdit}>
              <Pencil size={16} />
              编辑
            </Button>
          )}
          <Button
            className="button ghost compact"
            type="button"
            disabled={!ready}
            onClick={() => void runFileAction(() => api!.open(file.sha256, file.name), '打开失败')}
          >
            <ExternalLink size={16} />
            打开
          </Button>
          <Button
            className="icon-button"
            type="button"
            title="另存为"
            disabled={!ready}
            onClick={() =>
              void runFileAction(async () => {
                if (await api!.saveAs(file.sha256, file.name)) pushToast('已另存');
              }, '另存失败')
            }
          >
            <Download size={16} />
          </Button>
          <Button
            className="icon-button"
            type="button"
            title="在文件夹中显示"
            disabled={!ready}
            onClick={() => void runFileAction(() => api!.showInFolder(file.sha256, file.name), '打开文件夹失败')}
          >
            <FolderOpen size={16} />
          </Button>
          <Button
            className={`icon-button ${item.favorite ? 'is-active' : ''}`}
            type="button"
            title={item.favorite ? '取消收藏' : '收藏'}
            onClick={() => onToggleFavorite(item.id)}
          >
            <Heart size={16} />
          </Button>
          <Button className="icon-button danger-icon" type="button" title="删除" onClick={() => onDelete(item.id)}>
            <Trash2 size={16} />
          </Button>
        </div>
      </header>

      <DocumentInstruction
        fileName={file.name}
        fileText={text}
        instruction={item.description ?? ''}
        ready={ready}
        onCopy={(content, message) => void onCopyText(item.id, content, message)}
        onCopyFile={() => void onCopyFile(item)}
        onGetSharePath={() => api!.sharePath(file.sha256, file.name)}
        onSave={(content) => onSaveInstruction(item.id, content)}
      />

      <div className={`full-prompt-content document-content ${draft !== null ? 'is-editing' : ''}`}>
        {draft !== null ? (
          <>
            <Textarea
              autoFocus
              className="inline-content-editor"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft(null);
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault();
                  void saveEdit();
                }
              }}
            />
            <div className="inline-edit-actions">
              <Button className="button ghost" type="button" onClick={() => setDraft(null)}>
                取消
              </Button>
              <Button className="button primary" type="button" onClick={() => void saveEdit()}>
                保存修改
              </Button>
            </div>
          </>
        ) : !api ? (
          <p className="document-status">文档需要在桌面版里使用。</p>
        ) : status === 'checking' ? (
          <p className="document-status">正在准备文件…</p>
        ) : status === 'missing' ? (
          <p className="document-status is-error">
            {problem}
            <Button className="button ghost compact" type="button" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </Button>
          </p>
        ) : text !== null && isMarkdownDocument(file.name) ? (
          <div onDoubleClick={startEdit} title="双击编辑">
            <MarkdownView text={text} />
          </div>
        ) : text !== null ? (
          <pre onDoubleClick={startEdit} title="双击编辑">
            {text}
          </pre>
        ) : (
          <p className="document-status">这个格式不能在这里预览。点“复制文件”或拖动上面的标题就能发给别人，点“打开”用系统软件查看。</p>
        )}
      </div>
    </article>
  );
}
