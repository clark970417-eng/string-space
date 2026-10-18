import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, MapPin, Headphones } from "lucide-react";
import { ScorePreview } from "./ScorePreview";
import { alignmentScore, recognizedReference } from "../music/alignment-score";
import { automaticAlignment } from "../music/alignment";
import { ReferenceViewer } from "./ReferenceViewer";
import { Dialog } from "./Dialog";
import type { AudioPair, Piece, TimelineBar } from "../music/model";
import { validateAnchors } from "../music/timeline";
export function AudioDialog({
  piece,
  bars,
  onClose,
  onSave,
  track = 0,
  onRecognize,
}: {
  piece: Piece;
  bars: TimelineBar[];
  onClose: () => void;
  onSave: (p: AudioPair) => void;
  track?: number;
  onRecognize?: () => void;
}) {
  const [file, setFile] = useState<Blob | undefined>(piece.audio?.file),
    [name, setName] = useState(piece.audio?.name ?? ""),
    [duration, setDuration] = useState(piece.audio?.duration ?? 0),
    [anchors, setAnchors] = useState<number[]>(
      piece.audio?.anchors ?? Array(bars.length + 1).fill(NaN),
    ),
    [confirmed, setConfirmed] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [estimated, setEstimated] = useState(false),
    [selected, setSelected] = useState(0),
    [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [alignment, setAlignment] = useState<AudioPair["alignment"]>(piece.audio?.alignment);
  const job = useRef<AbortController | null>(null);
  const source = useMemo(() => piece.reference ?? recognizedReference(piece), [piece]);
  const reference = useMemo(() => {
    try {
      return { score: alignmentScore(piece, track), error: "" };
    } catch (e) {
      return { score: undefined, error: (e as Error).message };
    }
  }, [piece, track]);
  useEffect(
    () => () => {
      job.current?.abort();
    },
    [],
  );
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    const preview = audio.current;
    return () => preview?.pause();
  }, [url]);
  const setAnchor = (i: number, value: number) => {
    setConfirmed(false);
    setAlignment((a) => (a ? { ...a, edited: [...new Set([...a.edited, i])] } : undefined));
    setAnchors((a) => a.map((v, j) => (j === i ? value : v)));
  };
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const frame = () => {
      const t = audio.current?.currentTime ?? 0;
      setPosition(t);
      if (!validateAnchors(anchors, bars, duration)) {
        const i = anchors.findIndex((a, i) => i < bars.length && t >= a && t < anchors[i + 1]);
        if (i >= 0) setSelected(i);
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [playing, anchors, bars, duration]);
  const runAutomatic = async () => {
    if (!file || !reference.score) return;
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    audio.current?.pause();
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      const result = await automaticAlignment(
        file,
        reference.score,
        controller.signal,
        setProgress,
      );
      controller.signal.throwIfAborted();
      const problem = validateAnchors(result.anchors, bars, duration);
      if (problem) throw Error(problem);
      setAnchors(result.anchors);
      setAlignment({ ...result, edited: [] });
      setEstimated(false);
      setSelected(0);
      if (audio.current) audio.current.currentTime = result.anchors[0];
      setPosition(result.anchors[0]);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (job.current === controller) {
        setBusy(false);
        job.current = null;
      }
    }
  };
  const currentBar = bars[Math.min(selected, bars.length - 1)];
  const currentCrop = piece.recognition?.tab?.measures[currentBar?.index ?? 0];
  return (
    <Dialog title="配對你的音檔" onClose={onClose} wide={!!source || !!piece.scoreJson}>
      <div className="notice">
        <strong>自動分析音檔，預覽後再確認跟譜時間。</strong>
        <p>
          已校對的數位譜可自動比對錄音，容許前奏與速度變化。候選時間仍可試聽、修改；確認後才啟用。全部分析在本機完成，不上傳音檔。
        </p>
      </div>
      <label className="file-picker">
        <Upload size={18} />
        {file ? "更換音檔" : "選擇音檔（MP3 / WAV / M4A）"}
        <input
          type="file"
          disabled={busy}
          accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,.mp3,.wav,.m4a"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 100 * 1024 * 1024) {
              setError("音檔請小於 100 MB。");
              return;
            }
            job.current?.abort();
            setBusy(false);
            setAlignment(undefined);
            setFile(f);
            setName(f.name);
            setDuration(0);
            setAnchors(Array(bars.length + 1).fill(NaN));
            setConfirmed(false);
            setError("");
            setEstimated(false);
            setSelected(0);
            setPosition(0);
          }}
        />
      </label>
      {url && (
        <>
          <p className="audio-name">
            <Headphones size={16} />
            {name}
          </p>
          <audio
            ref={audio}
            controls
            src={url}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)}
            onLoadedMetadata={() => {
              const d = audio.current!.duration;
              if (Number.isFinite(d)) setDuration(d);
              else setError("無法讀取音檔長度，請改用其他檔案。");
            }}
            onError={() => setError("這個瀏覽器無法解碼此音檔。請改用 MP3 或 WAV。")}
          />
          <section className="automatic-alignment" aria-label="自動對齊">
            <div className="alignment-tools">
              <button
                type="button"
                className="primary"
                disabled={busy || !duration || !reference.score}
                onClick={() => void runAutomatic()}
              >
                自動分析並對齊音檔
              </button>
              {busy && (
                <button
                  type="button"
                  onClick={() => {
                    job.current?.abort();
                    job.current = null;
                    setBusy(false);
                    setProgress("已取消分析，可保留原有時間或手動校正。");
                  }}
                >
                  取消分析
                </button>
              )}
              {alignment && (
                <button
                  type="button"
                  disabled={busy || !!validateAnchors(anchors, bars, duration)}
                  onClick={() => {
                    if (audio.current) {
                      audio.current.currentTime = anchors[0];
                      void audio.current
                        .play()
                        .catch(() => setError("請按音檔播放器的播放鍵開始預覽。"));
                    }
                  }}
                >
                  預覽自動跟譜
                </button>
              )}
            </div>
            {progress && (
              <p role="status">
                {busy ? progress : alignment ? "自動候選已產生，請預覽並確認。" : progress}
              </p>
            )}
            {reference.error && (
              <>
                <p className="hint">{reference.error}</p>
                {piece.reference && onRecognize && (
                  <button type="button" onClick={onRecognize}>
                    先辨識 PDF 音符與節奏
                  </button>
                )}
              </>
            )}
            {alignment && (
              <div className="notice small" data-testid="alignment-result">
                <strong>
                  自動對齊候選 · 音高相似度 {Math.round(alignment.similarity * 100)}%（不是正確率）
                </strong>
                {alignment.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                {alignment.edited.length > 0 && (
                  <p>已人工修改 {alignment.edited.length} 個時間點，請再次試聽。</p>
                )}
              </div>
            )}
          </section>
          <section className="notice small">
            <p>
              校對位置：
              {selected === bars.length
                ? "樂譜結束"
                : `第 ${bars[selected]?.index + 1} 小節（第 ${(bars[selected]?.occurrence ?? 0) + 1} 次）`}{" "}
              · 音檔 {position.toFixed(2)} 秒
            </p>
            <button
              type="button"
              disabled={!duration || busy}
              onClick={() => {
                setAnchor(selected, Math.round((audio.current?.currentTime ?? 0) * 100) / 100);
                setSelected(Math.min(bars.length, selected + 1));
              }}
            >
              記下目前時間並到下一小節
            </button>
            <p>
              先標記第一小節起點，再一邊聽一邊標記後續起點；最後標記結束。可點原譜選取校對位置。
            </p>
          </section>
          {source && (
            <ReferenceViewer
              data={source}
              active={bars[Math.min(selected, bars.length - 1)]?.index ?? -1}
              jumpSignal={selected + 1}
              follow={playing}
              progress={
                currentBar && selected < bars.length && anchors[selected + 1] > anchors[selected]
                  ? Math.max(
                      0,
                      Math.min(
                        1,
                        (position - anchors[selected]) /
                          (anchors[selected + 1] - anchors[selected]),
                      ),
                    )
                  : 0
              }
              onSeek={(index) => {
                const next = bars.findIndex((b, i) => i >= selected && b.index === index);
                const target = next >= 0 ? next : bars.findIndex((b) => b.index === index);
                if (target >= 0) {
                  setSelected(target);
                  if (Number.isFinite(anchors[target]) && audio.current)
                    audio.current.currentTime = anchors[target];
                }
              }}
            />
          )}
          {!source && currentCrop && (
            <figure className="alignment-crop">
              <figcaption>
                原譜第 {currentBar.index + 1} 小節 · 第 {currentCrop.page} 頁
              </figcaption>
              <img src={currentCrop.image} alt={`原譜第 ${currentBar.index + 1} 小節辨識範圍`} />
            </figure>
          )}
          {piece.scoreJson && (
            <ScorePreview json={piece.scoreJson} bar={(currentBar?.index ?? 0) + 1} track={track} />
          )}
          <div className="alignment-tools">
            <button
              className="text-button"
              disabled={!duration || busy}
              onClick={() => {
                setAlignment(undefined);
                const start = Number.isFinite(anchors[0]) ? anchors[0] : 0;
                setAnchors([
                  ...bars.map((b) => start + b.startMs / 1000),
                  start + (bars.at(-1)?.endMs ?? 0) / 1000,
                ]);
                setEstimated(true);
                setConfirmed(false);
              }}
            >
              填入原譜速度的參考值
            </button>
            <small>長度 {duration.toFixed(2)} 秒</small>
          </div>
          {estimated && (
            <p className="notice small">
              這些時間只是依原譜速度推估，尚未校正。請逐項試聽與修改，確認後才會啟用跟譜。
            </p>
          )}
          <div className="anchor-list">
            {anchors.map((value, i) => (
              <div key={i}>
                <label htmlFor={`anchor-${i}`} onClick={() => setSelected(i)}>
                  {i === bars.length
                    ? "樂譜結束"
                    : `第 ${bars[i].index + 1} 小節${bars[i].occurrence ? `（第 ${bars[i].occurrence + 1} 次）` : ""}`}
                </label>
                <input
                  id={`anchor-${i}`}
                  type="number"
                  min="0"
                  max={duration}
                  step="0.01"
                  placeholder="秒"
                  value={Number.isFinite(value) ? value : ""}
                  disabled={busy}
                  onFocus={() => {
                    audio.current?.pause();
                    setSelected(i);
                  }}
                  onChange={(e) => setAnchor(i, e.target.value === "" ? NaN : +e.target.value)}
                />
                {alignment && i < bars.length && (
                  <small className={alignment.quality[i] < 0.7 ? "alignment-weak" : "hint"}>
                    {alignment.edited.includes(i)
                      ? "已人工修改"
                      : alignment.quality[i] < 0.7
                        ? "優先校正"
                        : "待確認"}
                  </small>
                )}
                <button
                  disabled={busy}
                  className="icon-button"
                  aria-label={`標記${i === bars.length ? "結束" : `小節 ${i + 1}`}目前時間`}
                  title="使用音檔目前時間"
                  onClick={() =>
                    setAnchor(i, Math.round((audio.current?.currentTime ?? 0) * 100) / 100)
                  }
                >
                  <MapPin size={17} />
                </button>
                <button
                  className="text-button compact"
                  disabled={busy || !Number.isFinite(value)}
                  onClick={() => {
                    setSelected(i);
                    if (audio.current) {
                      audio.current.currentTime = value;
                      void audio.current.play().catch(() => setError("請使用音檔播放鍵試聽。"));
                    }
                  }}
                >
                  試聽
                </button>
              </div>
            ))}
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              disabled={busy}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我已聽過並校正這些時間點
          </label>
          <p className="hint">
            錄音模式支援瀏覽器的保音高變速。節拍器與預備拍僅在合成播放模式提供。
          </p>
        </>
      )}
      {file && duration > 0 && validateAnchors(anchors, bars, duration) && (
        <p className="hint" role="status">
          {validateAnchors(anchors, bars, duration)}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          className="primary"
          disabled={
            busy || !file || !duration || !confirmed || !!validateAnchors(anchors, bars, duration)
          }
          onClick={() => {
            const err = validateAnchors(anchors, bars, duration);
            if (err) {
              setError(err);
              return;
            }
            audio.current?.pause();
            onSave({ file: file!, name, duration, anchors, confirmed: true, alignment });
          }}
        >
          保存時間對齊
        </button>
      </div>
    </Dialog>
  );
}
