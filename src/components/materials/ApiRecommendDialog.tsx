import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { loadHandledApiRecommendation, saveHandledApiRecommendation } from '../../localState';

// 管理员推荐的 API 地址（1.14.0 起，1.14.1 改成按账号单独设）：登录后，API 配置里有接口地址和推荐的不一样时提示一键替换，Key 和模型不变。
// 同一个推荐地址只问一次（换了或点「暂不」都记下），管理员换了新地址才再问。

const SLOT_LABELS: Record<MaterialAiSlotName, string> = { text: '文本模型', vision: '视觉模型', image: '生图模型' };
const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase();

type Candidate = { name: MaterialAiSlotName; current: string };

export function ApiRecommendDialog({ url, notify }: { url: string; notify: (message: string) => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<MaterialAiSlotName>>(new Set());
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setCandidates([]);
    const materialsApi = window.promptAssistantDesktop?.materials;
    if (!url || !materialsApi || loadHandledApiRecommendation() === url) return;
    let alive = true;
    void materialsApi.aiGetSettings().then(
      (settings) => {
        if (!alive) return;
        // 只换 OpenAI 兼容接口、已经填了地址的位置；Ollama 是本机服务，没填的位置没有 Key，换了也用不了。
        const found = (['text', 'vision', 'image'] as const).flatMap((name) => {
          const slot = settings[name];
          return slot && slot.provider === 'openai-compatible' && slot.baseUrl && !sameUrl(slot.baseUrl, url) ? [{ name, current: slot.baseUrl }] : [];
        });
        setCandidates(found);
        setPicked(new Set(found.map((entry) => entry.name)));
      },
      (error) => console.warn('读取 API 配置失败，没有提示推荐地址', error),
    );
    return () => {
      alive = false;
    };
  }, [url]);

  if (!candidates.length) return null;

  const close = () => {
    saveHandledApiRecommendation(url);
    setCandidates([]);
  };
  const apply = async () => {
    setWorking(true);
    try {
      await window.promptAssistantDesktop!.materials!.aiSetBaseUrl([...picked], url);
      notify(`已把${[...picked].map((name) => SLOT_LABELS[name]).join('、')}的接口地址换成管理员推荐的地址`);
      close();
    } catch (error) {
      notify(`替换接口地址失败：${error instanceof Error ? error.message : error}`);
    } finally {
      setWorking(false);
    }
  };
  const toggle = (name: MaterialAiSlotName) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  return (
    <div className="confirm-dialog-layer" role="presentation">
      <section className="confirm-dialog api-recommend" role="dialog" aria-labelledby="api-recommend-title">
        <div className="confirm-dialog-copy">
          <h2 id="api-recommend-title">换成管理员推荐的 API 地址？</h2>
          <p>
            推荐地址：<code>{url}</code>
          </p>
          <p className="api-recommend-note">只换接口地址，API Key 和模型都不变。以后也能在「设置 &gt; API 配置」里改回来。</p>
          <ul className="api-recommend-list">
            {candidates.map((entry) => (
              <li key={entry.name}>
                <label>
                  <input type="checkbox" checked={picked.has(entry.name)} onChange={() => toggle(entry.name)} />
                  <span>
                    <strong>{SLOT_LABELS[entry.name]}</strong>
                    <small>现在：{entry.current}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="confirm-dialog-actions">
          <Button className="button ghost" type="button" onClick={close}>
            暂不
          </Button>
          <Button className="button primary" type="button" disabled={working || picked.size === 0} onClick={() => void apply()}>
            替换
          </Button>
        </div>
      </section>
    </div>
  );
}
