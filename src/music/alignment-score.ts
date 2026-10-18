import { midi, model, Settings } from "@coderline/alphatab";
import type { Piece, TimelineBar, ReferenceData } from "./model";
import { buildTimeline } from "./timeline";
export type AlignmentNote = { start: number; end: number; pitch: number; velocity: number };
export type AlignmentScore = {
  notes: AlignmentNote[];
  boundaries: number[];
  bars: TimelineBar[];
  duration: number;
};
/** Use the engine's actual MIDI traversal: repeated bars and tied notes are already expanded. */
export function alignmentScore(piece: Piece, track = 0): AlignmentScore {
  if (
    !piece.scoreJson ||
    piece.reference ||
    (piece.recognition && piece.recognition.status !== "confirmed")
  )
    throw Error("請先辨識 PDF 的音符與節奏並完成校對，再自動對齊；只有小節框線無法進行音高配對。");
  const score = model.JsonConverter.jsonToScore(piece.scoreJson);
  const raw: { start: number; end: number; pitch: number; velocity: number }[] = [];
  const handler = new midi.AlphaSynthMidiFileHandler(new midi.MidiFile());
  const add = handler.addNote.bind(handler);
  handler.addNote = (...args) => {
    const [t, start, length, pitch, velocity, channel] = args;
    if (t === track && channel !== 9 && velocity > 0)
      raw.push({ start, end: start + length, pitch, velocity });
    add(...args);
  };
  const generator = new midi.MidiFileGenerator(score, new Settings(), handler);
  generator.generate();
  const bars = buildTimeline(generator.tickLookup);
  const lookup = generator.tickLookup.masterBars;
  const seconds = (tick: number) => {
    let elapsed = 0;
    for (const b of lookup) {
      if (tick < b.start) return elapsed;
      for (const [i, tempo] of b.tempoChanges.entries()) {
        const end = Math.min(tick, b.tempoChanges[i + 1]?.tick ?? b.end);
        if (end > tempo.tick) elapsed += ((end - tempo.tick) * 60) / (960 * tempo.tempo);
        if (tick <= end) return elapsed;
      }
      if (tick <= b.end) return elapsed;
    }
    return elapsed;
  };
  const duration = (bars.at(-1)?.endMs ?? 0) / 1000;
  const notes = raw
    .map((n) => ({ ...n, start: seconds(n.start), end: Math.min(duration, seconds(n.end)) }))
    .filter((n) => n.end > n.start);
  if (notes.length < 6 || new Set(notes.map((n) => n.pitch % 12)).size < 3)
    throw Error(
      "音高變化或音符數量不足，無法可靠自動對齊。請使用完整、有旋律的數位譜，或保留手動校時。",
    );
  return { notes, bars, duration, boundaries: [...bars.map((b) => b.startMs / 1000), duration] };
}
/** Retain real OCR crop coordinates, so recording mode can follow the original PDF. */
export function recognizedReference(piece: Piece | undefined): ReferenceData | undefined {
  const r = piece?.recognition,
    measures = r?.tab?.measures;
  if (
    !r ||
    r.status !== "confirmed" ||
    !measures?.length ||
    measures.length !== piece?.measures ||
    measures.some((m) => !m.bounds)
  )
    return;
  return {
    ...r.source,
    confirmed: true,
    markers: measures.map((m, i) => ({ id: `recognized-${i}`, page: m.page, ...m.bounds! })),
  };
}
