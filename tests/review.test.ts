import { it, expect } from "vitest";
import { model } from "@coderline/alphatab";
import { createDemo } from "../src/music/demo";
import {
  changeScore,
  confirmReview,
  reviewRows,
  rhythmIssue,
  setPitch,
  quarterBeats,
} from "../src/music/review";
it("requires every voice to be checked and rejects wrong rhythm even if checked", () => {
  const p = createDemo();
  const s = model.JsonConverter.jsonToScore(p.scoreJson!);
  p.recognition = {
    engine: "test",
    source: {} as any,
    rawScoreJson: p.scoreJson!,
    pages: "1",
    reviewed: [],
    shortBars: [],
    status: "draft",
    warnings: [],
  };
  expect(() => confirmReview(p)).toThrow();
  p.recognition.reviewed = reviewRows(s).map((r) => r.key);
  expect(confirmReview(p).recognition!.status).toBe("confirmed");
  p.scoreJson = changeScore(p.scoreJson!, (s) =>
    s.tracks[0].staves[0].bars[0].voices[0].beats.pop(),
  );
  expect(() => confirmReview(p)).toThrow();
});
it("edits pitch without changing duration; dotted tuplets and incomplete measures are explicit", () => {
  const p = createDemo();
  const json = changeScore(p.scoreJson!, (s) =>
    setPitch(s.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0], 60, s.tracks[0].staves[0]),
  );
  const row = reviewRows(model.JsonConverter.jsonToScore(json))[0];
  expect(row.voice.beats[0].notes[0].realValue).toBe(60);
  expect(rhythmIssue(row, false).error).toBe(false);
  row.voice.beats.pop();
  expect(rhythmIssue(row, false).error).toBe(true);
  expect(rhythmIssue(row, true).error).toBe(false);
  const b = new model.Beat();
  b.duration = 8;
  b.dots = 1;
  b.tupletNumerator = 3;
  b.tupletDenominator = 2;
  expect(quarterBeats(b)).toBe(0.5);
});

it("TAB confirmation requires explicit tuning and rhythm review; rejects impossible same-string chords", () => {
  const p = createDemo();
  const score = model.JsonConverter.jsonToScore(p.scoreJson!);
  const keys = reviewRows(score).map((r) => r.key);
  p.recognition = {
    engine: "TAB test",
    source: {} as any,
    rawScoreJson: p.scoreJson!,
    pages: "1",
    reviewed: keys,
    shortBars: [],
    status: "draft",
    warnings: [],
    tab: { measures: [], rhythmReviewed: [], setupConfirmed: false },
  };
  expect(() => confirmReview(p)).toThrow();
  p.recognition.tab!.setupConfirmed = true;
  expect(() => confirmReview(p)).toThrow();
  p.recognition.tab!.rhythmReviewed = keys;
  expect(confirmReview(p).recognition!.status).toBe("confirmed");
  p.scoreJson = changeScore(p.scoreJson!, (s) => {
    const b = s.tracks[0].staves[0].bars[0].voices[0].beats[0];
    const n = new model.Note();
    n.string = b.notes[0].string;
    n.fret = 2;
    b.addNote(n);
  });
  expect(() => confirmReview(p)).toThrow("每拍同一弦");
});
