import { useEffect, useMemo, useRef, useState } from "react";
import { model } from "@coderline/alphatab";
import type { Piece } from "../music/model";
import { cancelRecognition, omrHealth, omrRequest } from "../music/recognition";
import {
  changeScore,
  confirmReview,
  manualPiece,
  recognitionPiece,
  reviewRows,
  rhythmIssue,
  quarterBeats,
  setPitch,
} from "../music/review";
import { repeatIssue, repeatOrder, jumpChoices } from "../music/repeats";
import { tiePredecessor } from "../music/ties";
import { ReferenceViewer } from "./ReferenceViewer";
import { ScorePreview } from "./ScorePreview";
const pitchName = (n: number) =>
  ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][n % 12] +
  (Math.floor(n / 12) - 1);
export function RecognitionPanel({
  piece,
  onSave,
  onManual,
}: {
  piece: Piece;
  onSave: (p: Piece) => void;
  onManual: () => void;
}) {
  const [draft, setDraft] = useState<Piece | undefined>(piece.recognition ? piece : undefined),
    [scanType, setScanType] = useState("staff"),
    [originalZoom, setOriginalZoom] = useState(1),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState("正在檢查本機辨識服務…"),
    [error, setError] = useState(""),
    [pages, setPages] = useState(piece.recognition?.pages || "1"),
    [selected, setSelected] = useState(0),
    [outputs, setOutputs] = useState<{ name: string; data: string }[]>([]),
    [warnings, setWarnings] = useState<string[]>([]);
  const job = useRef(""),
    alive = useRef(true);
  const attempt = useRef(0);
  const tabAbort = useRef<AbortController | null>(null);
  const source = piece.recognition?.source || piece.reference!;
  useEffect(() => {
    alive.current = true;
    void omrHealth()
      .then((h) => {
        if (alive.current) {
          setReady(h.ready);
          setStage(h.ready ? "本機引擎已就緒" : "本機引擎尚未安裝；請執行 npm run omr:setup。");
        }
      })
      .catch(() => {
        if (alive.current) setStage("本機辨識服務未啟動，請執行 npm run omr。");
      });
    return () => {
      alive.current = false;
      attempt.current++;
      tabAbort.current?.abort();
      if (job.current) void cancelRecognition(job.current);
    };
  }, []);
  const score = useMemo(
    () => (draft?.scoreJson ? model.JsonConverter.jsonToScore(draft.scoreJson) : null),
    [draft?.scoreJson],
  );
  const orderIssue = score ? repeatIssue(score) : "";
  const order = useMemo(() => (score && !repeatIssue(score) ? repeatOrder(score) : []), [score]);
  const rows = useMemo(() => (score ? reviewRows(score) : []), [score]);
  const row = rows[Math.min(selected, Math.max(0, rows.length - 1))];
  const info = draft?.recognition;
  const issue = row ? rhythmIssue(row, info!.shortBars.includes(row.key)) : null;
  const allReady =
    !!info &&
    !orderIssue &&
    (!info.tab ||
      (info.tab.setupConfirmed && rows.every((r) => info.tab!.rhythmReviewed.includes(r.key)))) &&
    rows.length > 0 &&
    rows.every(
      (r) => info.reviewed.includes(r.key) && !rhythmIssue(r, info.shortBars.includes(r.key)).error,
    );
  function update(change: (s: model.Score) => void, all = false, removedBar?: number) {
    if (!draft || !info) return;
    try {
      const json = changeScore(draft.scoreJson!, change);
      setDraft({
        ...draft,
        scoreJson: json,
        recognition: {
          ...info,
          status: "draft",
          tab: info.tab
            ? {
                ...info.tab,
                setupConfirmed: all ? false : info.tab.setupConfirmed,
                measures:
                  removedBar === undefined
                    ? info.tab.measures
                    : info.tab.measures.filter((_, i) => i !== removedBar),
                rhythmReviewed: all
                  ? []
                  : info.tab.rhythmReviewed.filter(
                      (k) => ![row.b - 1, row.b, row.b + 1].includes(Number(k.split(":")[2])),
                    ),
              }
            : undefined,
          reviewed: all
            ? []
            : info.reviewed.filter(
                (k) => ![row.b - 1, row.b, row.b + 1].includes(Number(k.split(":")[2])),
              ),
        },
      });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function editBeat(index: number, change: (beat: model.Beat, staff: model.Staff) => void) {
    update((s) => {
      const staff = s.tracks[row.t].staves[row.s];
      change(staff.bars[row.b].voices[row.v].beats[index], staff);
    });
  }
  function useOutput(output: { name: string; data: string }, messages = warnings) {
    try {
      const bytes = Uint8Array.from(atob(output.data), (c) => c.charCodeAt(0));
      const p = recognitionPiece(
        { ...piece, reference: source },
        bytes,
        output.name,
        pages,
        messages,
      );
      setDraft(p);
      setSelected(0);
      setError("");
    } catch (e) {
      setError("辨識結果無法轉成數位譜：" + (e as Error).message);
    }
  }
  async function recognizeTabImage() {
    const token = ++attempt.current;
    const controller = new AbortController();
    tabAbort.current = controller;
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      controller.abort();
      if (alive.current && attempt.current === token) {
        setError("六線譜辨識超過三分鐘，請裁成較短段落後重試。");
        setBusy(false);
      }
    }, 180000);
    try {
      const { recognizeTab } = await import("../music/tab-recognition");
      const result = await recognizeTab(
        { ...piece, reference: source },
        pages,
        controller.signal,
        (s) => {
          if (alive.current && attempt.current === token) setStage(s);
        },
      );
      if (alive.current && attempt.current === token) {
        setDraft(result);
        setSelected(0);
      }
    } catch (e) {
      if (alive.current && attempt.current === token && !controller.signal.aborted)
        setError((e as Error).message || "六線譜辨識失敗，請改用手動輸入。");
    } finally {
      clearTimeout(timer);
      if (alive.current && attempt.current === token) {
        setBusy(false);
        tabAbort.current = null;
      }
    }
  }
  async function recognize() {
    const token = ++attempt.current;
    setBusy(true);
    setError("");
    setStage("正在送至本機辨識服務…");
    try {
      const type =
        source.mime === "application/pdf" ? "pdf" : source.mime === "image/png" ? "png" : "jpg";
      const result = await omrRequest(`/jobs?type=${type}&pages=${encodeURIComponent(pages)}`, {
        method: "POST",
        body: source.file,
        headers: { "Content-Type": "application/octet-stream" },
      });
      if (!alive.current || attempt.current !== token) {
        void cancelRecognition(result.id);
        return;
      }
      job.current = result.id;
      while (alive.current && job.current === result.id && attempt.current === token) {
        const status = await omrRequest(`/jobs/${result.id}`);
        if (!alive.current || job.current !== result.id || attempt.current !== token) return;
        setStage(status.stage || "辨識中");
        if (status.status === "error") throw Error(status.error);
        if (status.status === "done") {
          setOutputs(status.outputs);
          setWarnings(status.warnings || []);
          if (status.outputs.length === 1) useOutput(status.outputs[0], status.warnings || []);
          else setStage("辨識出多個樂章，請選擇要校對的樂章。");
          await cancelRecognition(result.id);
          job.current = "";
          break;
        }
        if (status.status === "cancelled") break;
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (e) {
      if (alive.current && attempt.current === token)
        setError((e as Error).message || "本機辨識服務連線中斷，請確認服務啟動後重試。");
    } finally {
      if (alive.current && attempt.current === token) {
        setBusy(false);
        if (job.current) {
          void cancelRecognition(job.current);
          job.current = "";
        }
      }
    }
  }
  const original = <ReferenceViewer data={source} />;
  if (!draft || !score || !row)
    return (
      <section className="recognition-panel">
        <h3>從原譜建立可播放的音符</h3>
        <p>
          選擇譜面類型，再辨識與逐小節校對。六線譜支援清晰、水平的印刷數字 0–24
          品；傾斜照片請先裁正。手寫、滑音與擊勾弦等技巧記號需手動整理。
        </p>
        <p className="notice">
          {scanType === "tab"
            ? "六線譜在此瀏覽器內辨識，不上傳原檔。可見符桿／符槓、四分至三十二分休止符、附點與帶括號的 3／5／6 連音可產生候選，仍需逐小節校對。全／二分休止符須有支撐線；延音線僅連接相鄰同弦同音；跨譜列／連續頁須兩端同向半弧線。缺少任一端與無括號連音需手動校對；數字間距不代表時值。"
            : "五線譜會傳到這台電腦的本機辨識服務，不送第三方。辨識完成後刪除暫存原檔；確認前不啟用整首播放。"}
        </p>
        <label className="field">
          辨識譜面類型
          <select
            aria-label="辨識譜面類型"
            value={scanType}
            disabled={busy}
            onChange={(e) => setScanType(e.target.value)}
          >
            <option value="staff">五線譜 · Audiveris 本機服務</option>
            <option value="tab">吉他六線譜 · 瀏覽器內辨識弦品</option>
          </select>
        </label>
        {source.mime === "application/pdf" && (
          <label className="field">
            辨識 PDF 頁碼（每次最多 8 頁）
            <input
              aria-label="辨識 PDF 頁碼"
              value={pages}
              onChange={(e) => setPages(e.target.value)}
              placeholder="例如 1-3 或 1,3"
              disabled={busy}
            />
            <small>只辨識指定頁面；其餘頁面仍可在原譜預覽查看。</small>
          </label>
        )}
        <p role="status">{scanType === "tab" && !busy ? "六線譜辨識不需要啟動本機服務" : stage}</p>
        {busy && <progress aria-label="辨識進度" />}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="review-actions">
          <button
            className="primary"
            disabled={(scanType === "staff" && !ready) || busy}
            onClick={() => void (scanType === "tab" ? recognizeTabImage() : recognize())}
          >
            {scanType === "tab" ? "辨識六線譜弦品" : "在本機辨識音符"}
          </button>
          {busy && (
            <button
              onClick={() => {
                attempt.current++;
                tabAbort.current?.abort();
                const id = job.current;
                job.current = "";
                void cancelRecognition(id);
                setBusy(false);
                setStage("已取消，可重新辨識或手動輸入。");
              }}
            >
              取消辨識
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => {
              setDraft(manualPiece({ ...piece, reference: source }));
              setError("");
            }}
          >
            手動輸入音符與節奏
          </button>
          <button disabled={busy} onClick={onManual}>
            只標記小節，使用節拍引導
          </button>
          <button disabled={busy} onClick={() => onSave(piece)}>
            保存原譜，稍後標記
          </button>
        </div>
        {outputs.length > 1 && (
          <div className="notice">
            {outputs.map((o) => (
              <button key={o.name} onClick={() => useOutput(o)}>
                校對樂章 {o.name}
              </button>
            ))}
          </div>
        )}
        {original}
        <p className="hint">
          引擎：
          <a
            href={
              scanType === "tab"
                ? "https://github.com/naptha/tesseract.js"
                : "https://github.com/Audiveris/audiveris/tree/5.11.0"
            }
            target="_blank"
            rel="noreferrer"
          >
            {scanType === "tab"
              ? "Tesseract.js 6.0.1 · Apache-2.0 授權"
              : "Audiveris 5.11.0 · 原始碼與 AGPL-3.0 授權"}
          </a>
        </p>
      </section>
    );
  return (
    <section className="recognition-panel">
      <div className="review-heading">
        <div>
          <h3>逐小節校對，再開始練習</h3>
          <p>
            {info!.engine} · 已確認 {rows.filter((r) => info!.reviewed.includes(r.key)).length} /{" "}
            {rows.length} 個小節聲部
          </p>
        </div>
        <span className="level-tag">尚待校對</span>
      </div>
      <p className="notice">
        {info!.tab
          ? "六線譜弦品來自原圖辨識候選。請對照原譜逐一核對弦號、品格、同時發聲、漏音、休止符與節奏。沒有節奏標記時，不會用數字間距冒充時值。延音線只接續前一同弦同音；修改弦品或插入休止符會取消不相容連結，相關小節須重新確認。"
          : "所有音符都需要人工核對；本版沒有可信的逐音符信心分數。請對照原譜檢查升降記號、八度、休止符、附點、連音與反覆。六線譜是系統建議指法。"}
      </p>
      <label className="field">
        曲目名稱
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </label>
      {info!.tab && (
        <fieldset className="tab-setup">
          <legend>先確認調弦與 Capo（尚未從圖片辨識）</legend>
          <div className="review-note-fields">
            {score.tracks[0].staves[0].tuning.map((pitch, i) => (
              <label key={i}>
                {i + 1} 弦空弦音高
                <select
                  aria-label={`調弦 ${i + 1} 弦`}
                  value={pitch}
                  onChange={(e) =>
                    update((s) => {
                      s.tracks[0].staves[0].stringTuning.tunings[i] = +e.target.value;
                    }, true)
                  }
                >
                  {Array.from({ length: 49 }, (_, n) => n + 28).map((n) => (
                    <option key={n} value={n}>
                      {pitchName(n)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Capo
              <select
                aria-label="校對 Capo"
                value={score.tracks[0].staves[0].capo}
                onChange={(e) =>
                  update((s) => {
                    s.tracks[0].staves[0].capo = +e.target.value;
                  }, true)
                }
              >
                {Array.from({ length: 13 }, (_, n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              aria-label="確認調弦與 Capo"
              checked={info!.tab.setupConfirmed}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recognition: {
                    ...info!,
                    tab: { ...info!.tab!, setupConfirmed: e.target.checked },
                  },
                })
              }
            />
            已確認調弦、Capo，並將核對各小節拍號與 BPM
          </label>
        </fieldset>
      )}
      <div className="review-layout">
        <div className="review-original">
          <h4>上傳的原譜</h4>
          <label className="field">
            原譜放大 {Math.round(originalZoom * 100)}%
            <input
              aria-label="原譜放大比例"
              type="range"
              min="1"
              max="4"
              step="0.25"
              value={originalZoom}
              onChange={(e) => setOriginalZoom(+e.target.value)}
            />
          </label>
          <div className="review-original-scroll">
            <div style={{ width: `${originalZoom * 100}%` }}>{original}</div>
          </div>
        </div>
        <div className="review-editor">
          <label className="field">
            校對小節與聲部
            <select
              aria-label="校對小節與聲部"
              value={selected}
              onChange={(e) => setSelected(+e.target.value)}
            >
              {rows.map((r, i) => (
                <option key={r.key} value={i}>
                  {info!.reviewed.includes(r.key) ? "✓" : "待核對"} 第 {r.b + 1} 小節 ·{" "}
                  {r.track.name || `聲部 ${r.t + 1}`} · 譜表 {r.s + 1}／音軌 {r.v + 1}
                </option>
              ))}
            </select>
          </label>
          {info!.tab && (
            <section className="tab-source-measure">
              <strong>
                第 {row.b + 1} 小節原圖 · 第 {info!.tab.measures[row.b]?.page ?? "—"} 頁
              </strong>
              {info!.tab.measures[row.b] ? (
                <>
                  <img alt={`第 ${row.b + 1} 小節辨識來源`} src={info!.tab.measures[row.b].image} />
                  {info!.tab.measures[row.b].boundaryFrom !== undefined &&
                    (() => {
                      const from = info!.tab!.measures[row.b].boundaryFrom!;
                      const source = info!.tab!.measures[from];
                      return source ? (
                        <details open>
                          <summary>
                            延音來源：第 {from + 1} 小節 · 第 {source.page} 頁（原始辨識候選）
                          </summary>
                          <img alt={`跨譜列延音來源第 ${from + 1} 小節`} src={source.image} />
                          <p>
                            請比對兩端弧線；可取消或勾選下方各音的延音線，修改後須重新確認相關小節。
                          </p>
                        </details>
                      ) : null;
                    })()}
                  <p>以下為原始辨識依據；增刪事件後，請以原圖位置對照，不代表目前校對結果。</p>
                  <ul>
                    {info!.tab.measures[row.b].messages.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>此小節為手動新增，請對照左側原譜。</p>
              )}
            </section>
          )}
          <fieldset>
            <legend>反覆與一、二房</legend>
            <p>
              修改順序會清除全譜確認。跨反覆起點、結束或房號邊界的延音暫不支援，將取消連結並重新撥弦；段落內的延音仍正常延長。
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                aria-label="本小節為反覆起點"
                checked={row.bar.masterBar.isRepeatStart}
                onChange={(e) =>
                  update((s) => {
                    s.masterBars[row.b].isRepeatStart = e.target.checked;
                  }, true)
                }
              />
              本小節為反覆起點
            </label>
            <label className="field">
              反覆結束與總遍數
              <select
                aria-label="反覆結束與總遍數"
                value={row.bar.masterBar.repeatCount}
                onChange={(e) =>
                  update((s) => {
                    s.masterBars[row.b].repeatCount = +e.target.value;
                  }, true)
                }
              >
                <option value="0">不是反覆結束</option>
                <option value="2">結束：總共 2 遍</option>
                <option value="3">結束：總共 3 遍</option>
                <option value="4">結束：總共 4 遍</option>
              </select>
            </label>
            <label className="field">
              本小節房號
              <select
                aria-label="本小節房號"
                value={row.bar.masterBar.alternateEndings}
                onChange={(e) =>
                  update((s) => {
                    s.masterBars[row.b].alternateEndings = +e.target.value;
                  }, true)
                }
              >
                <option value="0">無房號</option>
                <option value="1">一房（第 1 遍）</option>
                <option value="2">二房（第 2 遍）</option>
              </select>
            </label>
            <label className="field">
              本小節結尾跳轉（人工校對）
              <select
                aria-label="本小節結尾跳轉"
                value={jumpChoices.find(([d]) => row.bar.masterBar.directions?.has(d))?.[0] ?? -1}
                onChange={(e) =>
                  update((s) => {
                    const b = s.masterBars[row.b];
                    for (const [d] of jumpChoices) b.directions?.delete(d);
                    if (+e.target.value >= 0) b.addDirection(+e.target.value);
                  }, true)
                }
              >
                <option value="-1">不跳轉</option>
                {jumpChoices.map(([d, label]) => (
                  <option key={d} value={d}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                [model.Direction.TargetSegno, "本小節為 Segno 回跳目標"],
                [model.Direction.TargetFine, "本小節結尾為 Fine"],
              ] as const
            ).map(([d, label]) => (
              <label className="check-field" key={d}>
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={row.bar.masterBar.directions?.has(d) ?? false}
                  onChange={(e) =>
                    update((s) => {
                      if (e.target.checked) s.masterBars[row.b].addDirection(d);
                      else s.masterBars[row.b].directions?.delete(d);
                    }, true)
                  }
                />
                {label}
              </label>
            ))}
            <p className="hint">
              可校對兩層巢狀反覆；D.C.／D.S.
              需人工設定，尚未自動辨識，且暫不混用反覆或房號。跳轉邊界延音需重新撥弦。
            </p>
            {orderIssue ? (
              <p role="alert">{orderIssue}</p>
            ) : (
              <p data-testid="repeat-order">
                播放小節順序：{order.slice(0, 120).join(" → ")}
                {order.length > 120 ? " …" : ""}
              </p>
            )}
            <p>多小節房號請逐小節設定。未標反覆起點的結束記號會回到第 1 小節。</p>
          </fieldset>
          <ScorePreview json={draft.scoreJson!} bar={row.b + 1} track={row.t} />
          <div className="form-row">
            <label className="field">
              本小節拍號
              <select
                aria-label="本小節拍號"
                value={`${row.bar.masterBar.timeSignatureNumerator}/${row.bar.masterBar.timeSignatureDenominator}`}
                onChange={(e) =>
                  update((s) => {
                    const [n, d] = e.target.value.split("/").map(Number);
                    s.masterBars[row.b].timeSignatureNumerator = n;
                    s.masterBars[row.b].timeSignatureDenominator = d;
                  }, true)
                }
              >
                {Array.from(
                  new Set([
                    "2/4",
                    "3/4",
                    "4/4",
                    "6/8",
                    "9/8",
                    "12/8",
                    `${row.bar.masterBar.timeSignatureNumerator}/${row.bar.masterBar.timeSignatureDenominator}`,
                  ]),
                ).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              統一速度 BPM
              <input
                aria-label="校對速度 BPM"
                type="number"
                min="30"
                max="220"
                defaultValue={score.tempo}
                key={draft.id}
                onBlur={(e) => {
                  const v = +e.target.value;
                  if (!Number.isFinite(v) || v < 30 || v > 220) {
                    setError("速度請輸入 30–220 BPM。");
                    e.target.value = String(score.tempo);
                    return;
                  }
                  if (v !== score.tempo)
                    update((s) => {
                      s.masterBars.forEach((m) => (m.tempoAutomations = []));
                      s.masterBars[0].tempoAutomations = [
                        model.Automation.buildTempoAutomation(false, 0, v, 2),
                      ];
                    }, true);
                }}
              />
            </label>
          </div>
          <p
            className={issue!.error ? "error" : "success-line"}
            role={issue!.error ? "alert" : undefined}
          >
            以四分音符計：目前 {+issue!.actual.toFixed(3)} 拍／應有 {issue!.expected} 拍
            {issue!.error ? "。請補齊漏音、修正時值，或確認弱起小節。" : ""}
          </p>
          <label className="check-field">
            <input
              type="checkbox"
              checked={info!.shortBars.includes(row.key)}
              onChange={(e) => {
                const short = e.target.checked;
                const json = changeScore(draft.scoreJson!, (s) => {
                  s.masterBars[row.b].isAnacrusis = short;
                });
                setDraft({
                  ...draft,
                  scoreJson: json,
                  recognition: {
                    ...info!,
                    status: "draft",
                    reviewed: [],
                    shortBars: short
                      ? [...info!.shortBars, row.key]
                      : info!.shortBars.filter((k) => k !== row.key),
                  },
                });
              }}
            />
            此聲部是弱起／不完整小節（允許少拍，不允許超拍）
          </label>
          <div className="review-notes">
            {row.voice.beats.map((beat, i) => (
              <fieldset key={i} className="review-note">
                <legend>
                  事件 {i + 1} ·{" "}
                  {beat.isRest
                    ? "休止符"
                    : beat.notes.map((n) => pitchName(n.realValue)).join(" + ")}
                </legend>
                <p>
                  目前時值：{Number(quarterBeats(beat).toFixed(4))} 個四分拍
                  {beat.isRest ? " · 此段保持靜音" : ""}
                </p>
                {beat.isFullBarRest && (
                  <p>全小節休止：依目前拍號休止整個小節；附點與連音不適用。</p>
                )}
                <div className="review-note-fields">
                  <label>
                    種類
                    <select
                      aria-label={`事件 ${i + 1} 種類`}
                      value={beat.isRest ? "rest" : "note"}
                      onChange={(e) =>
                        editBeat(i, (b, staff) => {
                          b.notes = [];
                          b.isEmpty = false;
                          if (e.target.value === "note") {
                            const n = new model.Note();
                            setPitch(n, 64, staff);
                            b.addNote(n);
                          }
                        })
                      }
                    >
                      <option value="note">音符</option>
                      <option value="rest">休止符</option>
                    </select>
                  </label>
                  <label>
                    時值
                    <select
                      aria-label={`事件 ${i + 1} 時值`}
                      value={beat.duration}
                      onChange={(e) =>
                        editBeat(i, (b) => {
                          b.duration = +e.target.value;
                          b.isEmpty = false;
                        })
                      }
                    >
                      {[
                        [1, beat.isRest ? "全休止（單獨時休止整小節）" : "全音符"],
                        [2, "二分"],
                        [4, "四分"],
                        [8, "八分"],
                        [16, "十六分"],
                        [32, "三十二分"],
                        [64, "六十四分"],
                      ].map(([v, l]) => (
                        <option value={v} key={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    附點
                    <select
                      aria-label={`事件 ${i + 1} 附點`}
                      disabled={beat.isFullBarRest}
                      value={beat.dots}
                      onChange={(e) =>
                        editBeat(i, (b) => {
                          b.dots = +e.target.value;
                        })
                      }
                    >
                      {[0, 1, 2].map((v) => (
                        <option key={v} value={v}>
                          {v === 0 ? "無" : `${v} 個`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    連音比例（非延音線）
                    <select
                      aria-label={`事件 ${i + 1} 連音`}
                      disabled={beat.isFullBarRest}
                      value={
                        beat.tupletNumerator > 1
                          ? `${beat.tupletNumerator}:${beat.tupletDenominator}`
                          : "1:1"
                      }
                      onChange={(e) =>
                        editBeat(i, (b) => {
                          [b.tupletNumerator, b.tupletDenominator] = e.target.value
                            .split(":")
                            .map(Number);
                        })
                      }
                    >
                      {Array.from(
                        new Set([
                          "1:1",
                          "3:2",
                          "5:4",
                          "6:4",
                          beat.tupletNumerator > 1
                            ? `${beat.tupletNumerator}:${beat.tupletDenominator}`
                            : "1:1",
                        ]),
                      ).map((v) => (
                        <option key={v} value={v}>
                          {v === "1:1" ? "無" : v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {beat.tupletNumerator > 1 && (
                  <button
                    disabled={i + beat.tupletNumerator > row.voice.beats.length}
                    onClick={() =>
                      update((s) => {
                        const beats = s.tracks[row.t].staves[row.s].bars[row.b].voices[row.v].beats;
                        for (const b of beats.slice(i, i + beat.tupletNumerator)) {
                          b.tupletNumerator = beat.tupletNumerator;
                          b.tupletDenominator = beat.tupletDenominator;
                        }
                      })
                    }
                  >
                    將 {beat.tupletNumerator}:{beat.tupletDenominator} 套用至事件 {i + 1}–
                    {i + beat.tupletNumerator}
                  </button>
                )}
                {beat.notes.map((note, n) => (
                  <div className="review-pitch" key={n}>
                    <label>
                      音高
                      <select
                        aria-label={`事件 ${i + 1} 音高 ${n + 1}`}
                        value={note.realValue}
                        onChange={(e) =>
                          editBeat(i, (b, staff) => setPitch(b.notes[n], +e.target.value, staff))
                        }
                      >
                        {Array.from(
                          new Set([
                            ...Array.from({ length: 49 }, (_, j) => 40 + j),
                            note.realValue,
                          ]),
                        )
                          .sort((a, b) => a - b)
                          .map((p) => (
                            <option key={p} value={p}>
                              {pitchName(p)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      弦
                      <select
                        aria-label={`事件 ${i + 1} 弦 ${n + 1}`}
                        value={note.string}
                        onChange={(e) =>
                          editBeat(i, (b) => {
                            b.notes[n].string = +e.target.value;
                          })
                        }
                      >
                        {[1, 2, 3, 4, 5, 6].map((v) => (
                          <option key={v} value={7 - v}>
                            {v} 弦
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      品格
                      <input
                        aria-label={`事件 ${i + 1} 品格 ${n + 1}`}
                        type="number"
                        min="0"
                        max="24"
                        value={note.fret}
                        onChange={(e) => {
                          const v = +e.target.value;
                          if (v >= 0 && v <= 24)
                            editBeat(i, (b) => {
                              b.notes[n].fret = v;
                            });
                        }}
                      />
                    </label>
                    <label className="tie-review">
                      <input
                        type="checkbox"
                        aria-label={`事件 ${i + 1} 音 ${n + 1} 延音線`}
                        checked={note.isTieDestination}
                        disabled={!note.isTieDestination && !tiePredecessor(note)}
                        onChange={(e) =>
                          editBeat(i, (b) => {
                            b.notes[n].isTieDestination = e.target.checked;
                          })
                        }
                      />
                      {tiePredecessor(note)
                        ? `接續第 ${tiePredecessor(note)!.beat.voice.bar.index + 1} 小節事件 ${tiePredecessor(note)!.beat.index + 1}，不重新撥弦`
                        : "前一事件沒有同弦同音，不能接延音線"}
                    </label>
                    <button
                      onClick={() =>
                        editBeat(i, (b) => {
                          b.notes.splice(n, 1);
                        })
                      }
                    >
                      刪除此音
                    </button>
                  </div>
                ))}
                <div className="review-actions">
                  {!beat.isRest && (
                    <button
                      onClick={() =>
                        editBeat(i, (b, staff) => {
                          const n = new model.Note();
                          setPitch(n, 60, staff);
                          b.addNote(n);
                        })
                      }
                    >
                      加入同時發聲的音
                    </button>
                  )}
                  <button
                    onClick={() =>
                      update((s) => {
                        s.tracks[row.t].staves[row.s].bars[row.b].voices[row.v].beats.splice(i, 1);
                      })
                    }
                  >
                    刪除事件 {i + 1}
                  </button>
                </div>
              </fieldset>
            ))}
          </div>
          <div className="review-actions">
            <button
              onClick={() =>
                update((s) => {
                  const b = new model.Beat();
                  b.duration = model.Duration.Quarter;
                  b.isEmpty = false;
                  s.tracks[row.t].staves[row.s].bars[row.b].voices[row.v].addBeat(b);
                })
              }
            >
              新增四分休止符
            </button>
            <button
              onClick={() =>
                update((s) => {
                  const m = new model.MasterBar();
                  m.timeSignatureNumerator = 4;
                  m.timeSignatureDenominator = 4;
                  s.addMasterBar(m);
                  s.tracks.forEach((t) =>
                    t.staves.forEach((st) => {
                      const bar = new model.Bar();
                      const v = new model.Voice();
                      const b = new model.Beat();
                      b.duration = model.Duration.Whole;
                      b.isEmpty = false;
                      v.addBeat(b);
                      bar.addVoice(v);
                      st.addBar(bar);
                    }),
                  );
                }, true)
              }
            >
              新增小節
            </button>
            <button
              disabled={score.masterBars.length <= 1}
              onClick={() => {
                update(
                  (s) => {
                    s.masterBars.splice(row.b, 1);
                    s.tracks.forEach((t) => t.staves.forEach((st) => st.bars.splice(row.b, 1)));
                  },
                  true,
                  row.b,
                );
                setSelected(0);
              }}
            >
              刪除此小節
            </button>
          </div>
          {info!.tab && (
            <label className="check-field">
              <input
                type="checkbox"
                aria-label="確認六線譜節奏"
                checked={info!.tab.rhythmReviewed.includes(row.key)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    recognition: {
                      ...info!,
                      reviewed: info!.reviewed.filter((k) => k !== row.key),
                      tab: {
                        ...info!.tab!,
                        rhythmReviewed: e.target.checked
                          ? [...info!.tab!.rhythmReviewed, row.key]
                          : info!.tab!.rhythmReviewed.filter((k) => k !== row.key),
                      },
                    },
                  })
                }
              />
              已核對反覆順序、一二房、休止符、附點、連音、延音線與拍號（含未辨識的記號）
            </label>
          )}
          <label className="check-field review-confirm">
            <input
              aria-label="確認本小節音符與節奏"
              type="checkbox"
              disabled={
                issue!.error || !!(info!.tab && !info!.tab.rhythmReviewed.includes(row.key))
              }
              checked={info!.reviewed.includes(row.key)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recognition: {
                    ...info!,
                    status: "draft",
                    reviewed: e.target.checked
                      ? [...info!.reviewed, row.key]
                      : info!.reviewed.filter((k) => k !== row.key),
                  },
                })
              }
            />
            我已對照原譜，確認本小節的音符與節奏
          </label>
          <div className="review-actions">
            <button disabled={selected === 0} onClick={() => setSelected(selected - 1)}>
              上一小節聲部
            </button>
            <button
              disabled={selected >= rows.length - 1}
              onClick={() => setSelected(selected + 1)}
            >
              下一小節聲部
            </button>
          </div>
        </div>
      </div>
      {!!info!.warnings.length && (
        <details>
          <summary>辨識引擎提示（需人工檢查）</summary>
          {info!.warnings.map((w, i) => (
            <p className="hint" key={i}>
              {w}
            </p>
          ))}
        </details>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button onClick={() => onSave({ ...draft, recognition: { ...info!, status: "draft" } })}>
          保存校對草稿
        </button>
        <button
          className="primary"
          disabled={!allReady || !draft.title.trim()}
          onClick={() => {
            try {
              onSave(confirmReview(draft));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          確認全部，合成播放
        </button>
      </div>
    </section>
  );
}
