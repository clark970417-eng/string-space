import { importer, model } from "@coderline/alphatab";
import { defaultPractice, type Piece } from "./model";
// Frets from low E to high E. Null means a muted string.
export const chordShapes: Record<string, (number | null)[]> = {
  C: [null, 3, 2, 0, 1, 0],
  Am: [null, 0, 2, 2, 1, 0],
  G: [3, 2, 0, 0, 0, 3],
  Fmaj7: [null, null, 3, 2, 1, 0],
  Em: [0, 2, 2, 0, 0, 0],
  Dm: [null, null, 0, 2, 3, 1],
  D: [null, null, 0, 2, 3, 2],
  A: [null, 0, 2, 2, 2, 0],
  E: [0, 2, 2, 1, 0, 0],
};
export function createAccompaniment(
  title: string,
  sequence: { chord: string; beats: number }[],
  bpm: number,
  pattern: "block" | "arp",
): Piece {
  if (!sequence.length || sequence.length > 64 || !Number.isFinite(bpm) || bpm < 30 || bpm > 220)
    throw new Error("請設定 1–64 個和弦與 30–220 BPM。");
  const bars = sequence.map(({ chord, beats }) => {
    if (!chordShapes[chord] || !Number.isInteger(beats) || beats < 1 || beats > 8)
      throw new Error("請使用支援的和弦，每個和弦 1–8 拍。");
    const notes = chordShapes[chord]
      .map((f, i) => (f === null ? "" : `${f}.${6 - i}`))
      .filter(Boolean);
    const beat =
      pattern === "block"
        ? Array.from({ length: beats }, () => `(${notes.join(" ")}).4`)
        : Array.from({ length: beats * 2 }, (_, i) => `${notes[i % notes.length]}.8`);
    beat[0] += `{ch "${chord}"}`;
    return `\\ts ${beats} 4 ${beat.join(" ")}`;
  });
  const score = importer.ScoreLoader.loadAlphaTex(
    `\\tempo ${bpm} \\instrument 25 . ${bars.join(" | ")}`,
  );
  score.title = title.trim() || "我的和弦練習";
  score.subTitle = "練習伴奏";
  return {
    id: crypto.randomUUID(),
    title: score.title,
    kind: "chords",
    sourceName: "手動和弦",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    scoreJson: model.JsonConverter.scoreToJson(score),
    warnings: ["這是依和弦、拍數和伴奏型態產生的練習伴奏，不代表原曲旋律或編曲。"],
    suggestedFingering: true,
    practice: defaultPractice(),
    composer: "",
    measures: sequence.length,
    bpm,
    tuning: "E A D G B E",
    capo: 0,
  };
}
export function referenceScore(piece: Piece) {
  const r = piece.reference!;
  return importer.ScoreLoader.loadAlphaTex(
    `\\tempo ${r.bpm} . \\ts ${r.numerator} ${r.denominator} ${r.markers.map(() => Array.from({ length: r.numerator }, () => `r.${r.denominator}`).join(" ")).join(" | ")}`,
  );
}
