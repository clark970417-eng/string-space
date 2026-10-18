import { it, expect } from "vitest";
import { importer, model } from "@coderline/alphatab";
import { alignAudio } from "../src/music/alignment-dsp";
import { alignmentScore } from "../src/music/alignment-score";
import { createDemo } from "../src/music/demo";
import type { AlignmentNote } from "../src/music/alignment-score";
const pitches = [64, 67, 71, 62, 69, 65, 60, 66];
const notes: AlignmentNote[] = pitches.map((pitch, i) => ({
  pitch,
  start: i * 0.5,
  end: (i + 1) * 0.5,
  velocity: 90,
}));
export function performanceAudio(
  pitches: number[],
  times: number[],
  sampleRate = 11025,
  tail = 0.7,
) {
  const samples = new Float32Array(Math.ceil((times.at(-1)! + tail) * sampleRate));
  pitches.forEach((pitch, k) => {
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    for (
      let i = Math.floor(times[k] * sampleRate);
      i < Math.floor(times[k + 1] * sampleRate);
      i++
    ) {
      const t = i / sampleRate - times[k],
        remaining = times[k + 1] - i / sampleRate;
      const envelope = Math.min(1, t / 0.008, remaining / 0.015) * (0.65 + 0.35 * Math.exp(-t * 3));
      samples[i] =
        envelope *
        (0.26 * Math.sin(2 * Math.PI * frequency * t) +
          0.1 * Math.sin(4 * Math.PI * frequency * t) +
          0.035 * Math.sin(6 * Math.PI * frequency * t));
    }
  });
  return samples;
}
it("matches actual harmonically rich audio, free intro/outro and different measure tempos", () => {
  const times = [0.8, 1.25, 1.95, 2.55, 3, 3.85, 4.6, 5.2, 5.8];
  const result = alignAudio({
    samples: performanceAudio(pitches, times),
    sampleRate: 11025,
    notes,
    boundaries: [0, 1, 2, 3, 4],
  });
  result.anchors.forEach((t, i) =>
    expect(Math.abs(t - [0.8, 1.95, 3, 4.6, 5.8][i])).toBeLessThan(0.22),
  );
  expect(result.similarity).toBeGreaterThan(0.75);
});
it("preserves repeated occurrences instead of assigning the same audio time twice", () => {
  const ps = [...pitches, ...pitches],
    ns = ps.map((pitch, i) => ({ pitch, start: i * 0.5, end: (i + 1) * 0.5, velocity: 90 }));
  const times = Array.from({ length: ps.length + 1 }, (_, i) => 0.4 + i * 0.6);
  const result = alignAudio({
    samples: performanceAudio(ps, times),
    sampleRate: 11025,
    notes: ns,
    boundaries: [0, 2, 4, 6, 8],
  });
  result.anchors.forEach((t, i) => expect(Math.abs(t - (0.4 + i * 2.4))).toBeLessThan(0.22));
});
it("rejects silent, unrelated, too-short, rest-only and oversized inputs", () => {
  const input = {
    samples: performanceAudio(
      pitches,
      Array.from({ length: 9 }, (_, i) => i * 0.5),
    ),
    sampleRate: 11025,
    notes,
    boundaries: [0, 1, 2, 3, 4],
  };
  expect(() => alignAudio({ ...input, samples: new Float32Array(11025 * 5) })).toThrow("聲音");
  expect(() =>
    alignAudio({
      ...input,
      samples: performanceAudio(
        Array(8).fill(40),
        Array.from({ length: 9 }, (_, i) => i * 0.5),
      ),
    }),
  ).toThrow("相似度");
  expect(() => alignAudio({ ...input, notes: [] })).toThrow("音符");
  expect(() => alignAudio({ ...input, samples: new Float32Array(11025) })).toThrow("過短");
  expect(() => alignAudio({ ...input, boundaries: [0, 601] })).toThrow("10 分鐘");
});
it("extracts actual MIDI pitches, ties, repeats and tempo map rather than PDF dummy beats", () => {
  const piece = createDemo();
  piece.scoreJson = model.JsonConverter.scoreToJson(
    importer.ScoreLoader.loadAlphaTex(
      "\\tempo 120 . \\ro 0.1.4 3.1 7.1 2.1 | \\rc 2 5.1.4 1.1 0.2 6.1",
    ),
  );
  const score = alignmentScore(piece);
  expect(score.bars.map((b) => b.index)).toEqual([0, 1, 0, 1]);
  expect(score.boundaries).toEqual([0, 2, 4, 6, 8]);
  expect(score.notes.map((n) => n.pitch)).toEqual([
    64, 67, 71, 66, 69, 65, 59, 70, 64, 67, 71, 66, 69, 65, 59, 70,
  ]);
  expect(() => alignmentScore({ ...piece, scoreJson: undefined })).toThrow("辨識");
});

it("rejects a constant chord despite having enough individual notes and pitch classes", () => {
  const chordNotes = Array.from({ length: 4 }, (_, i) =>
    [60, 64, 67].map((pitch) => ({ pitch, start: i, end: i + 1, velocity: 90 })),
  ).flat();
  expect(() =>
    alignAudio({
      samples: performanceAudio(
        pitches,
        Array.from({ length: 9 }, (_, i) => i * 0.5),
      ),
      sampleRate: 11025,
      notes: chordNotes,
      boundaries: [0, 1, 2, 3, 4],
    }),
  ).toThrow("輪廓變化不足");
});
it("matches polyphonic chord changes", () => {
  const chords = [
    [60, 64, 67],
    [62, 65, 69],
    [59, 63, 66],
    [60, 65, 68],
  ];
  const chordNotes = chords.flatMap((keys, i) =>
    keys.map((pitch) => ({ pitch, start: i, end: i + 0.98, velocity: 90 })),
  );
  const times = [0.4, 1.5, 2.4, 3.7, 4.6];
  const samples = new Float32Array(Math.ceil(5.8 * 11025));
  for (let voice = 0; voice < 3; voice++) {
    const v = performanceAudio(
      chords.map((c) => c[voice]),
      times,
      11025,
      1.2,
    );
    v.forEach((x, i) => {
      samples[i] += x / 3;
    });
  }
  const result = alignAudio({
    samples,
    sampleRate: 11025,
    notes: chordNotes,
    boundaries: [0, 1, 2, 3, 4],
  });
  result.anchors.forEach((x, i) => expect(Math.abs(x - times[i])).toBeLessThan(0.24));
});
