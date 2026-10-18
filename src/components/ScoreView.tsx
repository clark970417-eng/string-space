import { useEffect, useRef, useState } from "react";
import {
  AlphaTabApi,
  model,
  LayoutMode,
  StaveProfile,
  TabRhythmMode,
  NotationElement,
  ScrollMode,
} from "@coderline/alphatab";
import type { Piece, PracticeSettings, Snapshot, TimelineBar } from "../music/model";
import { PracticeAudio } from "../music/audio";
import { referenceScore } from "../music/accompaniment";
type Props = {
  piece: Piece;
  settings: PracticeSettings;
  onEngine: (engine: PracticeAudio | null) => void;
  onState: (state: Snapshot) => void;
  onTimeline: (bars: TimelineBar[]) => void;
  onError: (message: string) => void;
  onBrowse: () => void;
  following: boolean;
  track: number;
  hidden?: boolean;
  jumpSignal: number;
};
export function ScoreView({
  piece,
  settings,
  onEngine,
  onState,
  onTimeline,
  onError,
  onBrowse,
  following,
  track,
  hidden,
  jumpSignal,
}: Props) {
  const element = useRef<HTMLDivElement>(null);
  const engine = useRef<PracticeAudio | null>(null);
  const follow = useRef(following);
  follow.current = following;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const [bounds, setBounds] = useState<
    { index: number; x: number; y: number; width: number; height: number }[]
  >([]);
  const [busy, setBusy] = useState(true);
  const callbacks = useRef({ onState, onTimeline, onError, onBrowse, onEngine });
  callbacks.current = { onState, onTimeline, onError, onBrowse, onEngine };
  useEffect(() => {
    const host = element.current!;
    const api = new AlphaTabApi(host, {
      core: { fontDirectory: "/font/", includeNoteBounds: true },
      display: {
        layoutMode: LayoutMode.Page,
        staveProfile: StaveProfile.Tab,
        scale: settings.zoom,
        barsPerRow: host.clientWidth < 500 ? 1 : host.clientWidth < 760 ? 2 : 4,
        padding: [8, 12, 16, 12],
      },
      notation: {
        rhythmMode: TabRhythmMode.ShowWithBars,
        elements: new Map([
          [NotationElement.ScoreTitle, false],
          [NotationElement.ScoreSubTitle, false],
          [NotationElement.ScoreArtist, false],
          [NotationElement.ScoreWords, false],
          [NotationElement.ScoreMusic, false],
          [NotationElement.ScoreWordsAndMusic, false],
          [NotationElement.GuitarTuning, false],
        ]),
      },
      player: {
        enablePlayer: true,
        soundFont: "/soundfont/sonivox.sf2",
        enableCursor: true,
        enableUserInteraction: false,
        enableElementHighlighting: true,
        scrollMode: ScrollMode.Off,
      },
    });
    const audio = new PracticeAudio(
      api,
      settings,
      (s) => callbacks.current.onState(s),
      (b) => callbacks.current.onTimeline(b),
      (e) => callbacks.current.onError(e),
    );
    api.settings.display.resources.barNumberColor = new model.Color(112, 135, 94);
    api.settings.display.resources.staffLineColor = new model.Color(145, 153, 134);
    api.settings.display.resources.mainGlyphColor = new model.Color(43, 54, 43);
    api.updateSettings();
    let lastRows = api.settings.display.barsPerRow;
    const resize = new ResizeObserver(() => {
      const rows = host.clientWidth < 500 ? 1 : host.clientWidth < 760 ? 2 : 4;
      if (rows !== lastRows) {
        lastRows = rows;
        api.settings.display.barsPerRow = rows;
        api.updateSettings();
        api.render();
      }
    });
    resize.observe(host);
    engine.current = audio;
    callbacks.current.onEngine(audio);
    const scrollTo = (y: number, height: number, force = false) => {
      if (hiddenRef.current || (!force && !follow.current)) return;
      const rect = host.getBoundingClientRect();
      const viewportHeight =
        window.innerHeight -
        (document.querySelector(".transport")?.getBoundingClientRect().height ?? 150) -
        35;
      const top = rect.top + y;
      if (force || top < 100 || top + height > viewportHeight)
        window.scrollTo({
          top: window.scrollY + top - 120,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
    };
    api.customScrollHandler = {
      forceScrollTo(b) {
        const r = b.barBounds.masterBarBounds.realBounds;
        scrollTo(r.y, r.h, true);
      },
      onBeatCursorUpdating(b) {
        const r = b.barBounds.masterBarBounds.realBounds;
        scrollTo(r.y, r.h);
      },
      [Symbol.dispose]() {},
    };
    const rendered = () => {
      setBusy(false);
      const b = api.boundsLookup;
      setBounds(
        api.score?.masterBars.flatMap((m) => {
          const r = b?.findMasterBar(m)?.realBounds;
          return r ? [{ index: m.index, x: r.x, y: r.y, width: r.w, height: r.h }] : [];
        }) ?? [],
      );
    };
    api.postRenderFinished.on(rendered);
    api.renderStarted.on(() => setBusy(true));
    const click = (beat: import("@coderline/alphatab").model.Beat) =>
      audio.seekBar(beat.voice.bar.masterBar.index);
    api.beatMouseDown.on(click);
    try {
      const score = piece.reference
        ? referenceScore(piece)
        : model.JsonConverter.jsonToScore(piece.scoreJson!);
      api.renderScore(score, [0]);
    } catch (e) {
      callbacks.current.onError(`無法開啟樂譜：${(e as Error).message}`);
      setBusy(false);
    }
    return () => {
      resize.disconnect();
      audio.dispose();
      api.destroy();
      engine.current = null;
      callbacks.current.onEngine(null);
    };
  }, [
    piece.id,
    piece.scoreJson,
    piece.reference?.confirmed,
    piece.reference?.markers,
    piece.reference?.bpm,
    piece.reference?.numerator,
    piece.reference?.denominator,
  ]);
  useEffect(() => {
    engine.current?.applySettings(settings);
  }, [settings]);
  useEffect(() => {
    const api = engine.current?.api;
    if (!api) return;
    api.settings.display.scale = settings.zoom;
    api.settings.display.staveProfile =
      settings.notation === "tab"
        ? StaveProfile.Tab
        : settings.notation === "score"
          ? StaveProfile.Score
          : StaveProfile.ScoreTab;
    api.updateSettings();
    api.render();
  }, [settings.zoom, settings.notation]);
  useEffect(() => {
    const api = engine.current?.api;
    if (!api?.score) return;
    api.renderTracks([api.score.tracks[track] ?? api.score.tracks[0]]);
    api.score.tracks.forEach((t, i) => api.changeTrackMute([t], i !== track));
  }, [track]);
  useEffect(() => {
    if (jumpSignal) engine.current?.api.scrollToCursor();
  }, [jumpSignal]);
  useEffect(() => {
    const fn = () => {
      if (engine.current?.state.playing) callbacks.current.onBrowse();
    };
    const key = (e: KeyboardEvent) => {
      if (
        ["PageDown", "PageUp", "ArrowDown", "ArrowUp"].includes(e.key) &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)
      )
        fn();
    };
    window.addEventListener("wheel", fn, { passive: true });
    window.addEventListener("touchmove", fn, { passive: true });
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("wheel", fn);
      window.removeEventListener("touchmove", fn);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <div className={`score-wrapper ${hidden ? "engine-hidden" : ""}`}>
      <div className="score-canvas" ref={element} />
      {busy && !hidden && (
        <div className="score-loading" role="status">
          正在排版樂譜與載入吉他音色…
        </div>
      )}
      <div className="measure-overlay">
        {bounds.map((b) => (
          <button
            key={b.index}
            className={`measure-hit ${settings.loop.enabled && b.index >= settings.loop.start - 1 && b.index <= settings.loop.end - 1 ? "in-loop" : ""}`}
            style={{ left: b.x, top: b.y, width: b.width, height: b.height }}
            onClick={() => engine.current?.seekBar(b.index)}
            aria-label={`跳到第 ${b.index + 1} 小節`}
            data-bar={b.index + 1}
          >
            <span className="measure-a11y">第 {b.index + 1} 小節</span>
            {settings.loop.enabled && b.index === settings.loop.start - 1 && (
              <span className="loop-flag">A</span>
            )}
            {settings.loop.enabled && b.index === settings.loop.end - 1 && (
              <span className="loop-flag end">B</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
