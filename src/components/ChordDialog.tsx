import { useState } from "react";
import { Plus, Trash2, Music2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { chordShapes, createAccompaniment } from "../music/accompaniment";
import type { Piece } from "../music/model";
export function ChordDiagram({ name }: { name: string }) {
  const frets = chordShapes[name];
  if (!frets) return null;
  return (
    <svg
      viewBox="0 0 88 100"
      width="66"
      height="76"
      aria-label={`${name} 和弦指法（左為第六弦）`}
      role="img"
    >
      <text x="44" y="13" textAnchor="middle" fontSize="13" fontWeight="600" fill="currentColor">
        {name}
      </text>
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={`f${i}`}
          x1="18"
          x2="70"
          y1={34 + i * 13}
          y2={34 + i * 13}
          stroke="currentColor"
          opacity={i === 0 ? 1 : 0.35}
          strokeWidth={i === 0 ? 2 : 1}
        />
      ))}
      {frets.map((f, i) => (
        <g key={i}>
          <line
            x1={18 + i * 10.4}
            x2={18 + i * 10.4}
            y1="34"
            y2="86"
            stroke="currentColor"
            opacity=".45"
          />
          {f === null || f === 0 ? (
            <text x={18 + i * 10.4} y="29" textAnchor="middle" fontSize="10" fill="currentColor">
              {f === null ? "×" : "○"}
            </text>
          ) : (
            <circle cx={18 + i * 10.4} cy={34 + (f - 0.5) * 13} r="4" fill="currentColor" />
          )}
        </g>
      ))}
    </svg>
  );
}
export function ChordDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (p: Piece) => void;
}) {
  const [title, setTitle] = useState("我的和弦練習"),
    [rows, setRows] = useState([
      { chord: "C", beats: 4 },
      { chord: "Am", beats: 4 },
      { chord: "Fmaj7", beats: 4 },
      { chord: "G", beats: 4 },
    ]),
    [bpm, setBpm] = useState(80),
    [pattern, setPattern] = useState<"block" | "arp">("arp"),
    [error, setError] = useState("");
  return (
    <Dialog title="用和弦，做一段練習伴奏" onClose={onClose}>
      <p className="notice">只有和弦也能練習換和弦。這裡產生的是練習伴奏，不會還原原曲旋律。</p>
      <label className="field">
        練習名稱
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </label>
      <div className="form-row">
        <label className="field">
          速度 BPM
          <input
            type="number"
            min="30"
            max="220"
            value={bpm}
            onChange={(e) => setBpm(+e.target.value)}
          />
        </label>
        <label className="field">
          伴奏型態
          <select value={pattern} onChange={(e) => setPattern(e.target.value as "block" | "arp")}>
            <option value="arp">八分音符分解和弦</option>
            <option value="block">每拍齊奏和弦</option>
          </select>
        </label>
      </div>
      <div className="chord-editor">
        {rows.map((r, i) => (
          <div key={i}>
            <span className="row-number">{String(i + 1).padStart(2, "0")}</span>
            <ChordDiagram name={r.chord} />
            <label className="field">
              和弦
              <select
                aria-label={`和弦 ${i + 1}`}
                value={r.chord}
                onChange={(e) =>
                  setRows(rows.map((row, j) => (j === i ? { ...row, chord: e.target.value } : row)))
                }
              >
                {Object.keys(chordShapes).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              拍數
              <input
                aria-label={`和弦 ${i + 1} 拍數`}
                type="number"
                min="1"
                max="8"
                value={r.beats}
                onChange={(e) =>
                  setRows(
                    rows.map((row, j) => (j === i ? { ...row, beats: +e.target.value } : row)),
                  )
                }
              />
            </label>
            <button
              className="icon-button"
              aria-label={`移除和弦 ${i + 1}`}
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="text-button"
        disabled={rows.length >= 64}
        onClick={() => setRows([...rows, { chord: "C", beats: 4 }])}
      >
        <Plus size={16} />
        新增和弦
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          className="primary"
          onClick={() => {
            try {
              onCreate(createAccompaniment(title, rows, bpm, pattern));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Music2 size={17} />
          建立練習伴奏
        </button>
      </div>
    </Dialog>
  );
}
