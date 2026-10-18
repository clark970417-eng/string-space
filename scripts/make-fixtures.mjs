import { writeFile, mkdir } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
const attrs = `<divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>6</staff-lines>${[
  ["E", 2],
  ["A", 2],
  ["D", 3],
  ["G", 3],
  ["B", 3],
  ["E", 4],
]
  .map(
    ([s, o], i) =>
      `<staff-tuning line="${i + 1}"><tuning-step>${s}</tuning-step><tuning-octave>${o}</tuning-octave></staff-tuning>`,
  )
  .join("")}<capo>0</capo></staff-details>`;
const note = (s, o, d, string, fret, type = "quarter") =>
  `<note>${s ? `<pitch><step>${s}</step><octave>${o}</octave></pitch>` : "<rest/>"}<duration>${d}</duration><type>${type}</type>${string ? `<notations><technical><string>${string}</string><fret>${fret}</fret></technical></notations>` : ""}</note>`;
const bars = [
  note("E", 4, 2, 1, 0) + note("G", 4, 2, 1, 3) + note(null, 0, 2) + note("B", 3, 2, 2, 0),
  note("C", 4, 4, 2, 1, "half") + note("D", 4, 4, 2, 3, "half"),
  note("G", 3, 2, 3, 0) + note("A", 3, 2, 3, 2) + note("B", 3, 2, 2, 0) + note("D", 4, 2, 2, 3),
  note("E", 4, 8, 1, 0, "whole"),
];
function make(count = 4, repeat = false) {
  return `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${count === 4 ? "真實匯入測試 · 四小節" : "長譜 · 四十八小節"}</work-title></work><identification><creator type="composer">弦間測試素材</creator></identification><part-list><score-part id="P1"><part-name>Guitar</part-name><score-instrument id="I1"><instrument-name>Guitar</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>25</midi-program></midi-instrument></score-part></part-list><part id="P1">${Array.from({ length: count }, (_, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes>${attrs}</attributes><direction><sound tempo="120"/></direction>` : ""}${repeat && i === 0 ? '<barline location="left"><repeat direction="forward"/></barline>' : ""}${bars[i % 4]}${repeat && i === 1 ? '<barline location="right"><repeat direction="backward" times="2"/></barline>' : ""}</measure>`).join("")}</part></score-partwise>`;
}
await mkdir("tests/fixtures", { recursive: true });
await mkdir("public/examples", { recursive: true });
const simple = make();
for (const [name, value] of [
  ["known.musicxml", simple],
  ["long.musicxml", make(48)],
  ["repeats.musicxml", make(4, true)],
  [
    "pitch-only.xml",
    simple
      .replaceAll(/<notations>.*?<\/notations>/g, "")
      .replaceAll(/<staff-details>.*?<\/staff-details>/g, ""),
  ],
  [
    "tempo-change.musicxml",
    simple.replace(
      '<measure number="3">',
      '<measure number="3"><direction><sound tempo="60"/></direction>',
    ),
  ],
])
  await writeFile("tests/fixtures/" + name, value);
await writeFile("public/examples/four-bars.musicxml", simple);
await writeFile(
  "tests/fixtures/known.mxl",
  zipSync({
    "META-INF/container.xml": strToU8(
      '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>',
    ),
    "score.musicxml": strToU8(simple),
  }),
);
// A generated A4 tone used ONLY to test user-audio decoding and timestamp mapping.
const sampleRate = 22050,
  seconds = 12,
  n = sampleRate * seconds,
  buffer = Buffer.alloc(44 + n * 2);
buffer.write("RIFF");
buffer.writeUInt32LE(36 + n * 2, 4);
buffer.write("WAVEfmt ", 8);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++)
  buffer.writeInt16LE(Math.sin((i / sampleRate) * 2 * Math.PI * 440) * 3000, 44 + i * 2);
await writeFile("tests/fixtures/test-tone.wav", buffer);
