import { Clock3, Folder, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import type { DeletedPromptRecord } from '../types';

type DeletedRecordsViewProps = {
  records: DeletedPromptRecord[];
  onClearAll: () => void;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
};

export function DeletedRecordsView({ records, onClearAll, onRemove, onRestore }: DeletedRecordsViewProps) {
  if (!records.length) {
    return (
      <section className="empty-state deleted-empty">
        <div className="empty-icon">
          <RotateCcw size={22} />
        </div>
        <h2>暂无删除记录</h2>
        <p>删除过的子文件会先放在这里，后续可以恢复到原来的主文件夹。</p>
      </section>
    );
  }

  return (
    <section className="prompt-list-section deleted-records-section">
      <div className="deleted-records-header">
        <div>
          <p className="eyebrow">Deleted Records</p>
          <h1>删除记录</h1>
          <span>{records.length} 条可恢复记录</span>
        </div>
        <Button className="button ghost danger deleted-clear-button" type="button" onClick={onClearAll}>
          <Trash2 size={16} />
          清空全部记录
        </Button>
      </div>

      <div className="deleted-record-list">
        {records.map((record) => (
          <article className="deleted-record-row" key={record.id}>
            <div className="deleted-record-main">
              <h2>{record.prompt.title}</h2>
              <p>{record.prompt.content}</p>
              <div className="deleted-record-meta">
                <span>
                  <Folder size={14} />
                  {record.prompt.category}
                </span>
                <span>
                  <Clock3 size={14} />
                  {new Intl.DateTimeFormat('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(record.deletedAt))}
                </span>
              </div>
            </div>
            <div className="deleted-record-actions">
              <Button className="button primary" type="button" onClick={() => onRestore(record.id)}>
                <RotateCcw size={16} />
                恢复
              </Button>
              <Button className="button ghost danger" type="button" onClick={() => onRemove(record.id)}>
                <Trash2 size={16} />
                移除记录
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
