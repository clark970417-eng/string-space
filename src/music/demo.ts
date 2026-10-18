import { importer, model } from "@coderline/alphatab";
import { chordShapes } from "./accompaniment";
import { defaultPractice, type Piece } from "./model";
// Original 16-bar beginner study. Fret.string notation uses conventional high E = 1.
export const demoTex = String.raw`\title "午後，慢慢彈"
\subtitle "A little room for six strings"
\music "弦間 · 原創練習曲"
\tempo 80
\instrument 25
\tuning E4 B3 G3 D3 A2 E2
.
\ts 4 4 :4 0.1 3.2 1.2 0.3 | 0.2 0.1 3.1 0.1 | 1.2 2.3 0.3 2.4 | 3.2.2 0.3.2 |
:4 0.1 3.2 1.2 0.3 | 0.2 3.2 0.1 3.1 | 1.2 0.2 2.3 0.3 | 1.2.2 r.2 |
:4 3.1 0.1 3.2 0.1 | 1.1 0.1 1.2 2.3 | 3.2 0.2 0.3 0.2 | 0.1.2 r.2 |
:4 0.1 3.2 1.2 0.3 | 0.2 3.2 0.1 3.2 | 1.2 0.2 2.3 0.3 | (0.1 1.2 0.3 2.4 3.5).1`;
export function createDemo(): Piece {
  const score = importer.ScoreLoader.loadAlphaTex(demoTex);
  const harmony = [
    "C",
    "G",
    "Am",
    "G",
    "C",
    "G",
    "Am",
    "C",
    "Em",
    "Fmaj7",
    "G",
    "C",
    "C",
    "G",
    "Am",
    "C",
  ];
  const staff = score.tracks[0].staves[0];
  harmony.forEach((name, index) => {
    const chord = new model.Chord();
    chord.name = name;
    chord.strings = chordShapes[name].map((f) => f ?? -1).reverse();
    chord.showDiagram = false;
    staff.addChord(name, chord);
    staff.bars[index].voices[0].beats[0].chordId = name;
  });
  return {
    id: "original-afternoon",
    title: score.title,
    kind: "score",
    sourceName: "弦間原創示範曲",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    scoreJson: model.JsonConverter.scoreToJson(score),
    warnings: [],
    suggestedFingering: false,
    practice: defaultPractice(),
    composer: score.music,
    measures: score.masterBars.length,
    bpm: score.tempo,
    tuning: "E A D G B E",
    capo: 0,
    demo: true,
  };
}
