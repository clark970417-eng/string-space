import { useState, useRef } from "react";
import { Upload, FileMusic, FileImage, Check, ArrowRight, ShieldCheck } from "lucide-react";
import { Dialog } from "./Dialog";
import { ScorePreview } from "./ScorePreview";
import { ReferenceViewer } from "./ReferenceViewer";
import { importFile, IMPORT_ACCEPT } from "../music/importer";
import type { Piece } from "../music/model";
import { model } from "@coderline/alphatab";
import { RecognitionPanel } from "./RecognitionPanel";
export function ImportDialog({
  onClose,
  onImport,
  existing,
}: {
  onClose: () => void;
  onImport: (piece: Piece) => void;
  existing?: Piece;
}) {
  const [pending, setPending] = useState<Piece | undefined>(existing),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [drag, setDrag] = useState(false);
  const [manual, setManual] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = async (file?: File) => {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const p = await importFile(file);
      setPending(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  function confirm() {
    if (!pending) return;
    let p = { ...pending };
    if (!p.title.trim()) {
      setError("請填寫曲目名稱。");
      return;
    }
    if (p.reference) {
      if (!Number.isFinite(p.reference.bpm) || p.reference.bpm < 30 || p.reference.bpm > 220) {
        setError("BPM 請填寫 30–220。");
        return;
      }
      p = {
        ...p,
        audio:
          existing?.reference &&
          JSON.stringify(existing.reference.markers) !== JSON.stringify(p.reference.markers)
            ? undefined
            : p.audio,
        measures: p.reference.markers.length,
        bpm: p.reference.bpm,
        reference: { ...p.reference, confirmed: p.reference.markers.length > 0 },
        practice: {
          ...p.practice,
          tick: 0,
          metronome: true,
          loop: {
            start: 1,
            end: Math.max(1, Math.min(4, p.reference.markers.length)),
            enabled: false,
          },
        },
      };
    } else if (p.scoreJson) {
      const score = model.JsonConverter.jsonToScore(p.scoreJson);
      score.title = p.title;
      p.scoreJson = model.JsonConverter.scoreToJson(score);
    }
    onImport(p);
  }
  if (pending?.recognition || (pending?.reference && !manual))
    return (
      <Dialog title="圖片與 PDF · 辨識與校對" onClose={onClose} wide>
        <RecognitionPanel piece={pending} onSave={onImport} onManual={() => setManual(true)} />
      </Dialog>
    );
  return (
    <Dialog
      title={existing ? "校對與小節標記" : "讓你的樂譜，開始發聲"}
      onClose={onClose}
      wide={!!pending?.reference}
    >
      <div className="import-steps">
        <span className="done">1 選擇樂譜</span>
        <i />
        <span className={pending ? "done" : ""}>2 預覽與校對</span>
        <i />
        <span>3 開始練習</span>
      </div>
      {!pending ? (
        <>
          <div
            className={`dropzone ${drag ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (!busy) void load(e.dataTransfer.files[0]);
            }}
          >
            <div className="upload-glyph">
              <Upload size={28} />
            </div>
            <h3>把樂譜放在這裡</h3>
            <p>拖曳檔案，或從裝置中選取</p>
            <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? "正在讀取…" : "選擇樂譜檔案"}
              <ArrowRight size={16} />
            </button>
            <input
              ref={input}
              type="file"
              accept={IMPORT_ACCEPT}
              className="sr-only"
              aria-label="選擇樂譜檔案"
              onChange={(e) => void load(e.target.files?.[0])}
            />
          </div>
          {busy && (
            <div className="import-progress">
              <progress aria-label="本機讀取與解析中" />
              <p role="status">正在本機解析與檢查樂譜…</p>
            </div>
          )}
          <div className="format-explainer">
            <div>
              <FileMusic size={22} />
              <div>
                <strong>可播放的數位譜</strong>
                <p>MusicXML · .xml / .musicxml / .mxl</p>
                <small>讀取音符、節奏與原譜提供的弦號。</small>
              </div>
            </div>
            <div>
              <FileImage size={22} />
              <div>
                <strong>原始圖片與 PDF</strong>
                <p>JPG / PNG / PDF</p>
                <small>辨識印刷五線譜或吉他六線譜，校對音符、弦品與節奏後播放。</small>
              </div>
            </div>
          </div>
          <p className="hint">
            Guitar Pro 檔案請先匯出 MusicXML。本版不直接支援 .gp / .gp5 / .gpx。
          </p>
        </>
      ) : (
        <>
          <div className="success-line">
            <Check size={18} />
            {pending.reference ? "原譜已讀取，等待手動校對" : "已解析真實樂譜內容"}
          </div>
          <label className="field">
            曲目名稱
            <input
              value={pending.title}
              maxLength={120}
              onChange={(e) => setPending({ ...pending, title: e.target.value })}
            />
          </label>
          {pending.reference ? (
            <>
              <div className="notice">
                <strong>尚未辨識音符，無法合成原譜旋律。</strong>
                <p>先框選小節並設定節奏，就能跟著節拍器看原譜練習；也可以另配自己的音檔。</p>
              </div>
              <div className="form-row">
                <label className="field">
                  速度 BPM
                  <input
                    type="number"
                    min={30}
                    max={220}
                    value={pending.reference.bpm}
                    onChange={(e) =>
                      setPending({
                        ...pending,
                        reference: { ...pending.reference!, bpm: Number(e.target.value) },
                      })
                    }
                  />
                </label>
                <label className="field">
                  拍號
                  <select
                    value={`${pending.reference.numerator}/${pending.reference.denominator}`}
                    onChange={(e) => {
                      const [n, d] = e.target.value.split("/").map(Number);
                      setPending({
                        ...pending,
                        reference: { ...pending.reference!, numerator: n, denominator: d },
                      });
                    }}
                  >
                    {["2/4", "3/4", "4/4", "6/8"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>
              <ReferenceViewer
                data={pending.reference}
                edit
                onChange={(r) => setPending({ ...pending, reference: r })}
              />
            </>
          ) : (
            <>
              <div className="import-summary">
                <div>
                  <strong>{pending.measures}</strong>
                  <span>小節</span>
                </div>
                <div>
                  <strong>{pending.bpm}</strong>
                  <span>BPM</span>
                </div>
                <div>
                  <strong>{pending.capo || "無"}</strong>
                  <span>Capo</span>
                </div>
              </div>
              <p className="hint">調弦（低 → 高）：{pending.tuning}</p>
              {pending.scoreJson && <ScorePreview json={pending.scoreJson} />}
              {pending.warnings.map((w) => (
                <p className="notice small" key={w}>
                  {w}
                </p>
              ))}
            </>
          )}
          <div className="dialog-actions">
            <button
              className="text-button"
              onClick={() => {
                if (existing) onClose();
                else setPending(undefined);
              }}
            >
              {existing ? "取消" : "重新選擇"}
            </button>
            <button className="primary" onClick={confirm}>
              {pending.reference && !pending.reference.markers.length
                ? "保存原譜，稍後標記"
                : "確認並開始練習"}
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="privacy">
        <ShieldCheck size={15} />
        原檔保存在此瀏覽器。只有按下「在本機辨識音符」，才會送到本機辨識服務；不送往第三方。
      </p>
    </Dialog>
  );
}
