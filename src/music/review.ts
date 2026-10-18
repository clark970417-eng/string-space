import { model, Settings, importer } from "@coderline/alphatab";
import { defaultPractice, type Piece, type ReferenceData } from "./model";
import { repeatIssue } from "./repeats";
import { repairTies, invalidTies } from "./ties";
import { parseMusicXml } from "./importer";
export type Recognition = {
  tab?: import("./tab-recognition").TabReview;
  engine: string;
  source: ReferenceData;
  rawScoreJson: string;
  pages: string;
  reviewed: string[];
  shortBars: string[];
  status: "draft" | "confirmed";
  warnings: string[];
};
export const voiceKey = (t: number, s: number, b: number, v: number) => `${t}:${s}:${b}:${v}`;
export function reviewRows(score: model.Score) {
  return score.tracks.flatMap((track, t) =>
    track.staves.flatMap((staff, s) =>
      staff.bars.flatMap((bar, b) =>
        bar.voices
          .map((voice, v) => ({ key: voiceKey(t, s, b, v), t, s, b, v, voice, staff, bar, track }))
          .filter((r) => r.v === 0 || !r.voice.isEmpty),
      ),
    ),
  );
}
export function quarterBeats(beat: model.Beat) {
  if (beat.voice && beat.isFullBarRest) return beat.voice.bar.masterBar.calculateDuration() / 960;
  return (
    (4 / beat.duration) *
    (2 - 1 / 2 ** beat.dots) *
    (beat.tupletNumerator > 0 ? beat.tupletDenominator / beat.tupletNumerator : 1)
  );
}
export function rhythmIssue(row: ReturnType<typeof reviewRows>[number], short: boolean) {
  const actual = row.voice.beats.reduce(
    (sum, b) => sum + (b.graceType === model.GraceType.None ? quarterBeats(b) : 0),
    0,
  );
  const expected =
    (row.bar.masterBar.timeSignatureNumerator * 4) / row.bar.masterBar.timeSignatureDenominator;
  return {
    actual,
    expected,
    error:
      actual <= 0 || actual > expected + 0.001 || (!short && Math.abs(actual - expected) > 0.001),
  };
}
export function setPitch(note: model.Note, pitch: number, staff: model.Staff) {
  const candidates = staff.tuning
    .map((open, i) => ({
      string: staff.tuning.length - i,
      fret: pitch - open - staff.capo + staff.transpositionPitch,
    }))
    .filter((n) => n.fret >= 0 && n.fret <= 24)
    .sort((a, b) => a.fret - b.fret);
  if (!candidates.length) throw Error("此音高超出目前調弦 0–24 品，請選擇可彈奏的音高。");
  note.string = candidates[0].string;
  note.fret = candidates[0].fret;
  note.isTieDestination = false;
  note.tieOrigin = null;
  note.tieDestination = null;
}
export function changeScore(json: string, change: (s: model.Score) => void) {
  const s = model.JsonConverter.jsonToScore(json);
  change(s);
  repairTies(s);
  for (const row of reviewRows(s))
    for (const beat of row.voice.beats)
      if (beat.isFullBarRest) {
        beat.dots = 0;
        beat.tupletNumerator = beat.tupletDenominator = 1;
      }
  const clean = model.JsonConverter.jsonToScore(model.JsonConverter.scoreToJson(s));
  clean.finish(new Settings());
  return model.JsonConverter.scoreToJson(clean);
}
export function recognitionPiece(
  source: Piece,
  bytes: Uint8Array,
  name: string,
  pages: string,
  warnings: string[],
): Piece {
  const parsed = parseMusicXml(bytes, name);
  const json = model.JsonConverter.scoreToJson(parsed.score);
  return {
    ...source,
    kind: "score",
    reference: undefined,
    original: source.reference!.file,
    scoreJson: json,
    measures: parsed.score.masterBars.length,
    bpm: parsed.score.tempo,
    suggestedFingering: true,
    practice: { ...defaultPractice(), notation: "both" },
    warnings: [
      "圖片辨識結果已建立；每個小節都需要人工核對。原譜指法未辨識，六線譜為系統建議指法。",
      ...parsed.warnings,
    ],
    recognition: {
      engine: "Audiveris 5.11.0",
      source: source.reference!,
      rawScoreJson: json,
      pages,
      reviewed: [],
      shortBars: [],
      status: "draft",
      warnings,
    },
  };
}
export function manualPiece(source: Piece): Piece {
  const score = importer.ScoreLoader.loadAlphaTex(
    '\\title "手動校對" \\tempo 80 \\instrument 25 . \\ts 4 4 r.1',
  );
  const json = model.JsonConverter.scoreToJson(score);
  return {
    ...source,
    kind: "score",
    reference: undefined,
    original: source.reference!.file,
    scoreJson: json,
    measures: 1,
    bpm: 80,
    practice: defaultPractice(),
    suggestedFingering: true,
    warnings: ["這是你依原圖手動輸入的數位譜，不是自動辨識結果。"],
    recognition: {
      engine: "手動輸入",
      source: source.reference!,
      rawScoreJson: json,
      pages: "1",
      reviewed: [],
      shortBars: [],
      status: "draft",
      warnings: [],
    },
  };
}
export function confirmReview(piece: Piece): Piece {
  const score = model.JsonConverter.jsonToScore(piece.scoreJson!);
  const info = piece.recognition!;
  const rows = reviewRows(score);
  if (
    (info.tab &&
      (!info.tab.setupConfirmed || rows.some((r) => !info.tab!.rhythmReviewed.includes(r.key)))) ||
    !rows.length ||
    rows.some(
      (r) => !info.reviewed.includes(r.key) || rhythmIssue(r, info.shortBars.includes(r.key)).error,
    )
  )
    throw Error("請修正每個小節的拍數，並逐項確認音符與節奏。");
  if (
    info.tab &&
    rows.some((r) =>
      r.voice.beats.some(
        (b) =>
          new Set(b.notes.map((n) => n.string)).size !== b.notes.length ||
          b.notes.some(
            (n) =>
              !Number.isInteger(n.string) ||
              n.string < 1 ||
              n.string > 6 ||
              !Number.isInteger(n.fret) ||
              n.fret < 0 ||
              n.fret > 24,
          ),
      ),
    )
  )
    throw Error("請修正弦品：每拍同一弦只能有一個音，品格需為 0–24 的整數。");
  if (invalidTies(score))
    throw Error("延音線必須接續前一事件的同弦同音，不能跨過休止符或缺拍小節。");
  const orderError = repeatIssue(score);
  if (orderError) throw Error(orderError);
  score.title = piece.title;
  return {
    ...piece,
    scoreJson: model.JsonConverter.scoreToJson(score),
    measures: score.masterBars.length,
    bpm: score.tempo,
    capo: score.tracks[0].staves[0].capo,
    tuning: score.tracks[0].staves[0].tuning
      .slice()
      .reverse()
      .map((n) => ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][n % 12])
      .join(" "),
    updatedAt: Date.now(),
    audio: undefined,
    recognition: { ...info, status: "confirmed" },
    practice: {
      ...piece.practice,
      tick: 0,
      loop: { start: 1, end: Math.min(4, score.masterBars.length), enabled: false },
    },
  };
}
