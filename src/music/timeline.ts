import type { midi, model } from "@coderline/alphatab";
import type { TimelineBar } from "./model";
export const PPQ = 960;
export function buildTimeline(cache: midi.MidiTickLookup): TimelineBar[] {
  let ms = 0;
  const occurrences = new Map<number, number>();
  return cache.masterBars.map((bar) => {
    const startMs = ms;
    const changes = bar.tempoChanges;
    for (let i = 0; i < changes.length; i++) {
      ms +=
        (((changes[i + 1]?.tick ?? bar.end) - changes[i].tick) * 60000) / (PPQ * changes[i].tempo);
    }
    const index = bar.masterBar.index;
    const occurrence = occurrences.get(index) ?? 0;
    occurrences.set(index, occurrence + 1);
    return {
      index,
      occurrence,
      startTick: bar.start,
      endTick: bar.end,
      startMs,
      endMs: ms,
      tempo: changes[0]?.tempo ?? 80,
      numerator: bar.masterBar.timeSignatureNumerator,
      denominator: bar.masterBar.timeSignatureDenominator,
    };
  });
}
export function barAtTick(bars: TimelineBar[], tick: number) {
  return bars.find((b) => tick >= b.startTick && tick < b.endTick) ?? bars.at(-1);
}
export function loopTicks(bars: TimelineBar[], start: number, end: number) {
  const a = bars.findIndex((b) => b.index === start - 1);
  const b = bars.findIndex((b, i) => i >= a && b.index === end - 1);
  if (a < 0 || b < a || start > end) throw new Error("循環的結束小節必須在起始小節之後。");
  return { startTick: bars[a].startTick, endTick: bars[b].endTick };
}
export function boundaryTicks(bars: TimelineBar[]) {
  return [...bars.map((b) => b.startTick), bars.at(-1)?.endTick ?? 0];
}
export function validateAnchors(anchors: number[], bars: TimelineBar[], duration: number) {
  if (anchors.length !== bars.length + 1) return "請設定每個小節起點，以及最後的結束時間。";
  if (
    anchors.some(
      (x, i) => !Number.isFinite(x) || x < 0 || x > duration || (i > 0 && x <= anchors[i - 1]),
    )
  )
    return "時間需逐項增加，並且介於 0 與音檔總長度之間。";
  return "";
}
export function interpolate(value: number, from: number[], to: number[]) {
  if (!from.length || from.length !== to.length) return 0;
  if (value <= from[0]) return to[0];
  for (let i = 1; i < from.length; i++)
    if (value < from[i])
      return to[i - 1] + ((value - from[i - 1]) / (from[i] - from[i - 1])) * (to[i] - to[i - 1]);
  return to.at(-1)!;
}
export function firstBeat(score: model.Score, index: number) {
  return score.tracks[0]?.staves[0]?.bars[index]?.voices[0]?.beats[0];
}
