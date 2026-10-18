import { useEffect, useRef } from "react";
import {
  Play,
  Pause,
  SkipBack,
  Repeat2,
  Volume2,
  Timer,
  Minus,
  Plus,
  AudioLines,
} from "lucide-react";
import type { Piece, PracticeSettings, Snapshot, TimelineBar } from "../music/model";
import { formatTime } from "../music/model";
import type { PracticeAudio } from "../music/audio";
export function Transport({
  state,
  settings,
  onSettings,
  engine,
  onLoop,
  onSound,
  piece,
  bars,
}: {
  state: Snapshot;
  settings: PracticeSettings;
  onSettings: (p: Partial<PracticeSettings>) => void;
  engine: PracticeAudio | null;
  onLoop: () => void;
  onSound: () => void;
  piece: Piece;
  bars: TimelineBar[];
}) {
  const el = useRef<HTMLElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--transport-height",
        `${el.current?.getBoundingClientRect().height ?? 155}px`,
      ),
    );
    if (el.current) observer.observe(el.current);
    return () => observer.disconnect();
  }, []);
  const rangeStart = bars.find((b) => b.index === settings.loop.start - 1),
    rangeEnd = bars.find((b) => b.index === settings.loop.end - 1);
  const loopStart =
    state.mode === "audio"
      ? (piece.audio?.anchors[bars.indexOf(rangeStart!)] ?? 0) * 1000
      : (rangeStart?.startMs ?? 0) / settings.speed;
  const loopEnd =
    state.mode === "audio"
      ? (piece.audio?.anchors[bars.indexOf(rangeEnd!) + 1] ?? 0) * 1000
      : (rangeEnd?.endMs ?? 0) / settings.speed;
  const canSpeed = state.mode === "synth" || engine?.preservesPitch;
  return (
    <footer className="transport" ref={el} aria-label="播放控制列">
      <div className="transport-progress">
        <span className={`progress-label ${state.counting ? "is-counting" : ""}`}>
          <span className={`status-dot ${state.playing ? "pulsing" : ""}`} />
          <span className="transport-status">
            {state.counting
              ? "預備一小節…"
              : state.playing
                ? "跟著這一拍"
                : state.ready
                  ? "準備好了，慢慢來"
                  : "正在準備"}
          </span>
          <span className="current-measure" data-testid="bar-label">
            第 {state.bar + 1} / {piece.measures} 小節 · {state.beat} 拍
          </span>
        </span>
        <div className="progress-track">
          {settings.loop.enabled && state.duration > 0 && (
            <div
              className="range-highlight"
              style={{
                left: `${(loopStart / state.duration) * 100}%`,
                width: `${((loopEnd - loopStart) / state.duration) * 100}%`,
              }}
            />
          )}
          <input
            aria-label="播放進度"
            type="range"
            min="0"
            max={Math.max(1, state.duration)}
            value={Math.min(state.time, state.duration)}
            step="1"
            disabled={!state.ready}
            onChange={(e) => engine?.seekTime(+e.target.value)}
            style={
              {
                "--progress": `${state.duration ? (state.time / state.duration) * 100 : 0}%`,
              } as React.CSSProperties
            }
          />
        </div>
        <span className="time" data-testid="clock">
          {formatTime(state.time)} <span>/ {formatTime(state.duration)}</span>
        </span>
      </div>
      <div className="transport-controls">
        <div className="play-group">
          <button
            className="icon-button"
            aria-label="回到開頭"
            title="回到開頭"
            disabled={!state.ready}
            onClick={() => engine?.seekTick(0)}
          >
            <SkipBack size={20} />
          </button>
          <button
            className="play-button"
            aria-label={state.playing ? "暫停" : "播放"}
            disabled={!state.ready}
            onClick={() => engine?.toggle()}
          >
            {state.playing ? (
              <Pause size={21} fill="currentColor" />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
            <span>{state.playing ? "暫停" : "播放"}</span>
          </button>
          <div className="beat-indicator" aria-label={`目前第 ${state.beat} 拍`}>
            <div>
              {Array.from(
                { length: Math.min(bars.find((b) => b.index === state.bar)?.numerator ?? 4, 8) },
                (_, i) => (
                  <i key={i} className={i === state.beat - 1 ? "on" : ""} />
                ),
              )}
            </div>
            <span>
              {state.mode === "audio"
                ? "你的音檔"
                : piece.kind === "reference"
                  ? "節拍引導"
                  : piece.kind === "chords"
                    ? "練習伴奏"
                    : "吉他合成音色"}
            </span>
          </div>
        </div>
        <div className="tempo-control">
          <span className="control-label">練習速度</span>
          <button
            className="icon-button"
            aria-label="放慢速度"
            disabled={!canSpeed || settings.speed <= 0.25}
            onClick={() =>
              onSettings({ speed: Math.max(0.25, Math.round((settings.speed - 0.05) * 100) / 100) })
            }
          >
            <Minus size={15} />
          </button>
          <select
            aria-label="播放速度"
            value={settings.speed}
            disabled={!canSpeed}
            onChange={(e) => onSettings({ speed: +e.target.value })}
          >
            {Array.from(new Set([0.25, 0.5, 0.75, 1, 1.25, 1.5, settings.speed]))
              .sort((a, b) => a - b)
              .map((s) => (
                <option key={s} value={s}>
                  {s.toFixed(2).replace(/0$/, "")}×
                </option>
              ))}
          </select>
          <button
            className="icon-button"
            aria-label="加快速度"
            disabled={!canSpeed || settings.speed >= 1.5}
            onClick={() =>
              onSettings({ speed: Math.min(1.5, Math.round((settings.speed + 0.05) * 100) / 100) })
            }
          >
            <Plus size={15} />
          </button>
          <span className="bpm-small">
            {Math.round(state.tempo || piece.bpm * settings.speed)} BPM
          </span>
        </div>
        <button className="mobile-volume icon-button" aria-label="音量與播放設定" onClick={onSound}>
          <Volume2 size={19} />
        </button>
        <div className="practice-actions">
          <button
            className={`control-toggle ${settings.loop.enabled ? "selected" : ""}`}
            onClick={onLoop}
            disabled={!piece.measures}
          >
            <Repeat2 size={18} />
            <span>
              {settings.loop.enabled
                ? `${settings.loop.start}–${settings.loop.end} 循環`
                : "A–B 循環"}
            </span>
          </button>
          <button
            className={`control-toggle ${settings.metronome ? "selected" : ""}`}
            disabled={state.mode === "audio"}
            title={state.mode === "audio" ? "錄音模式不提供節拍器" : "開關節拍器"}
            aria-pressed={settings.metronome}
            onClick={() => onSettings({ metronome: !settings.metronome })}
          >
            <AudioLines size={18} />
            <span>節拍器</span>
          </button>
          <button
            className={`control-toggle count-in ${settings.countIn ? "selected" : ""}`}
            disabled={state.mode === "audio"}
            aria-pressed={settings.countIn}
            title="播放前預備一小節；錄音模式不提供"
            onClick={() => onSettings({ countIn: !settings.countIn })}
          >
            <Timer size={18} />
            <span>預備拍</span>
          </button>
        </div>
        <label className="volume">
          <Volume2 size={18} />
          <input
            aria-label="音量"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={settings.volume}
            onChange={(e) => onSettings({ volume: +e.target.value })}
          />
        </label>
      </div>
    </footer>
  );
}
