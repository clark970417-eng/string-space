import { useState } from "react";
import { Repeat2 } from "lucide-react";
import { Dialog } from "./Dialog";
import type { PracticeSettings } from "../music/model";
export function LoopDialog({
  loop,
  count,
  current,
  onClose,
  onSave,
}: {
  loop: PracticeSettings["loop"];
  count: number;
  current: number;
  onClose: () => void;
  onSave: (l: PracticeSettings["loop"]) => void;
}) {
  const [start, setStart] = useState(Math.min(loop.start, count)),
    [end, setEnd] = useState(Math.min(loop.end, count));
  return (
    <Dialog title="一小段，慢慢練熟" onClose={onClose}>
      <p className="dialog-intro">選擇起點 A 與終點 B，播放完就回到起點。</p>
      <div className="loop-fields">
        <label className="field">
          <span className="loop-letter">A</span>起始小節
          <select
            aria-label="循環起始小節"
            value={start}
            onChange={(e) => setStart(+e.target.value)}
          >
            {Array.from({ length: count }, (_, i) => (
              <option value={i + 1} key={i}>
                第 {i + 1} 小節
              </option>
            ))}
          </select>
        </label>
        <div className="loop-line" />
        <label className="field">
          <span className="loop-letter">B</span>結束小節
          <select aria-label="循環結束小節" value={end} onChange={(e) => setEnd(+e.target.value)}>
            {Array.from({ length: count }, (_, i) => (
              <option value={i + 1} key={i}>
                第 {i + 1} 小節
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="text-button"
        onClick={() => {
          setStart(current + 1);
          setEnd(Math.min(count, current + 4));
        }}
      >
        從目前小節開始
      </button>
      <p className="hint">
        含原譜反覆記號時，區間從 A 首次出現到其後 B 首次結束；其中的原譜反覆仍會演奏。
      </p>
      {start > end && <p className="error">結束小節不能早於起始小節。</p>}
      <div className="dialog-actions">
        {loop.enabled && (
          <button onClick={() => onSave({ ...loop, enabled: false })}>關閉循環</button>
        )}
        <button
          className="primary"
          disabled={start > end}
          onClick={() => onSave({ start, end, enabled: true })}
        >
          <Repeat2 size={18} />
          開始循環練習
        </button>
      </div>
    </Dialog>
  );
}
