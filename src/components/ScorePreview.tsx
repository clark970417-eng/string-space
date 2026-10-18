import { useEffect, useRef } from "react";
import {
  AlphaTabApi,
  model,
  StaveProfile,
  NotationElement,
  TabRhythmMode,
} from "@coderline/alphatab";
export function ScorePreview({
  json,
  bar,
  track = 0,
}: {
  json: string;
  bar?: number;
  track?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const api = new AlphaTabApi(host.current!, {
      core: { fontDirectory: "/font/" },
      display: {
        barCount: bar ? 1 : 4,
        startBar: bar ?? 1,
        barsPerRow: host.current!.clientWidth < 440 ? 1 : 2,
        scale: 1,
        staveProfile: bar ? StaveProfile.ScoreTab : StaveProfile.Tab,
        padding: [15, 8, 15, 8],
      },
      notation: {
        rhythmMode: TabRhythmMode.ShowWithBars,
        elements: new Map([
          [NotationElement.ScoreTitle, false],
          [NotationElement.ScoreSubTitle, false],
          [NotationElement.ScoreMusic, false],
          [NotationElement.ScoreWordsAndMusic, false],
          [NotationElement.GuitarTuning, false],
        ]),
      },
    });
    api.renderScore(model.JsonConverter.jsonToScore(json), [track]);
    return () => api.destroy();
  }, [json, bar, track]);
  return (
    <div className="score-preview">
      <span className="eyebrow">
        {bar ? `第 ${bar} 小節 · 校對後的數位譜` : "前四小節預覽 · 請與原譜比對"}
      </span>
      <div ref={host} />
    </div>
  );
}
