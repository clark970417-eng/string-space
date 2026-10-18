import { importer, model, Settings } from "@coderline/alphatab";
import { unzipSync, strFromU8 } from "fflate";
import { defaultPractice, type Piece, type Score } from "./model";
export const IMPORT_ACCEPT = ".musicxml,.xml,.mxl,.png,.jpg,.jpeg,.pdf";
const STANDARD = [64, 59, 55, 50, 45, 40];
export function suggestFingering(score: Score) {
  let suggested = 0;
  let impossible = 0;
  for (const track of score.tracks)
    for (const staff of track.staves) {
      if (staff.isPercussion) continue;
      const notes = staff.bars.flatMap((bar) =>
        bar.voices.flatMap((v) => v.beats.flatMap((b) => b.notes)),
      );
      const pitches = new Map(notes.map((n) => [n.id, n.realValue]));
      if (!staff.tuning.length)
        staff.stringTuning = new model.Tuning("Standard", [...STANDARD], true);
      for (const bar of staff.bars)
        for (const voice of bar.voices)
          for (const beat of voice.beats) {
            const used = new Set(beat.notes.filter((n) => n.isStringed).map((n) => n.string));
            for (const note of beat.notes) {
              if (note.isStringed) continue;
              const pitch = pitches.get(note.id)!;
              const options = staff.tuning
                .map((open, index) => ({
                  string: staff.tuning.length - index,
                  fret: pitch - open - staff.capo + staff.transpositionPitch,
                }))
                .filter((x) => x.fret >= 0 && x.fret <= 24 && !used.has(x.string))
                .sort((a, b) => a.fret - b.fret);
              if (options.length) {
                note.string = options[0].string;
                note.fret = options[0].fret;
                used.add(note.string);
                suggested++;
              } else impossible++;
            }
          }
      staff.showTablature = true;
      staff.showStandardNotation = true;
    }
  score.finish(new Settings());
  return { suggested, impossible };
}
export function parseMusicXml(
  bytes: Uint8Array,
  name: string,
): { score: Score; warnings: string[]; suggested: boolean } {
  if (bytes.length > 20 * 1024 * 1024)
    throw new Error("樂譜超過 20 MB。請匯出較小的 MusicXML 後再試。");
  let xmlBytes = bytes;
  if (name.toLowerCase().endsWith(".mxl")) {
    let total = 0;
    const zip = unzipSync(bytes, {
      filter: (item) => {
        total += item.originalSize;
        if (total > 24 * 1024 * 1024) throw new Error("壓縮樂譜解壓後過大。");
        return /\.(xml|musicxml)$/i.test(item.name);
      },
    });
    const container = zip["META-INF/container.xml"];
    const xml = container
      ? new DOMParser().parseFromString(strFromU8(container), "application/xml")
      : null;
    const path = xml?.querySelector("rootfile")?.getAttribute("full-path");
    const candidate = path
      ? zip[path]
      : Object.entries(zip).find(([key]) => !key.startsWith("META-INF/"))?.[1];
    if (!candidate) throw new Error("MXL 裡找不到 MusicXML 樂譜。");
    xmlBytes = candidate;
  }
  const text = new TextDecoder().decode(xmlBytes);
  if (/<!ENTITY/i.test(text))
    throw new Error("此 XML 含有不支援的實體宣告，請重新匯出一般 MusicXML。");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("MusicXML 結構損壞，請重新匯出檔案。");
  if (doc.documentElement.localName !== "score-partwise")
    throw new Error("目前支援 MusicXML score-partwise。請從製譜軟體重新匯出此格式。");
  if (!doc.querySelector("part > measure")) throw new Error("這份樂譜沒有可讀取的小節。");
  if (doc.querySelectorAll("measure").length > 1200 || doc.querySelectorAll("note").length > 40000)
    throw new Error("樂譜過長，請分成數個樂章匯入。");
  const settings = new Settings();
  settings.importer.maxDecodingBufferSize = 24 * 1024 * 1024;
  const score = importer.ScoreLoader.loadScoreFromBytes(xmlBytes, settings);
  if (!score.masterBars.length || !score.tracks.length) throw new Error("找不到可播放的樂譜資料。");
  const missingOriginal = [...doc.querySelectorAll("note")].some(
    (n) =>
      n.querySelector("pitch") &&
      (!n.querySelector("technical > string") || !n.querySelector("technical > fret")),
  );
  const { suggested, impossible } = suggestFingering(score);
  // The practice instrument is nylon guitar; only the selected part is heard.
  for (const track of score.tracks)
    if (!track.staves.some((s) => s.isPercussion)) track.playbackInfo.program = 24;
  const warnings: string[] = [];
  if (missingOriginal || suggested)
    warnings.push("系統建議指法：部分音符沒有原譜弦號／品格，已依音高配上可用位置；請依手感校對。");
  if (impossible)
    warnings.push(`${impossible} 個音符無法安排在目前調弦的 0–24 品內；請使用五線譜查看這些音符。`);
  if (score.tracks.length > 1)
    warnings.push(`共有 ${score.tracks.length} 個聲部；練習時只播放所選聲部，可在譜面上方切換。`);
  if (
    doc.querySelector(
      "direction-type > segno, direction-type > coda, sound[dal-segno], sound[da-capo]",
    )
  )
    warnings.push("含有 D.C.／D.S.／Coda 跳奏；請對照原譜檢查實際播放順序。");
  warnings.push("MusicXML 的特殊演奏記號可能有呈現差異；匯入後請先試聽並與原譜比對。");
  return { score, warnings, suggested: missingOriginal || suggested > 0 };
}
export async function importFile(file: File): Promise<Piece> {
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  const base = {
    id: crypto.randomUUID(),
    title: file.name.replace(/\.[^.]+$/, ""),
    sourceName: file.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    practice: defaultPractice(),
    composer: "",
    warnings: [] as string[],
    suggestedFingering: false,
    measures: 0,
    bpm: 80,
    tuning: "E A D G B E",
    capo: 0,
  };
  if (["png", "jpg", "jpeg", "pdf"].includes(ext ?? "")) {
    if (file.size > 35 * 1024 * 1024) throw new Error("圖片或 PDF 請小於 35 MB。");
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const valid =
      ext === "pdf"
        ? strFromU8(header).startsWith("%PDF-")
        : ext === "png"
          ? header[0] === 137 && header[1] === 80
          : header[0] === 255 && header[1] === 216;
    if (!valid) throw new Error("檔案內容與副檔名不一致，請選擇有效的圖片或 PDF。");
    const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
    return {
      ...base,
      kind: "reference",
      reference: {
        file: new Blob([file], { type: mime }),
        mime,
        markers: [],
        bpm: 80,
        numerator: 4,
        denominator: 4,
        confirmed: false,
      },
      warnings: ["尚未辨識音符。可以查看原譜並手動標記小節；不會自動產生旋律。"],
    };
  }
  if (!["xml", "musicxml", "mxl"].includes(ext ?? ""))
    throw new Error(
      "目前可匯入 MusicXML（.xml、.musicxml、.mxl）、JPG、PNG、PDF。Guitar Pro 請先匯出 MusicXML。",
    );
  if (file.size > 20 * 1024 * 1024)
    throw new Error("樂譜超過 20 MB。請匯出較小的 MusicXML 後再試。");
  const parsed = parseMusicXml(new Uint8Array(await file.arrayBuffer()), file.name);
  const score = parsed.score;
  const staff = score.tracks[0].staves[0];
  return {
    ...base,
    title: score.title || base.title,
    kind: "score",
    scoreJson: model.JsonConverter.scoreToJson(score),
    original: file,
    warnings: parsed.warnings,
    suggestedFingering: parsed.suggested,
    composer: score.music,
    measures: score.masterBars.length,
    bpm: score.tempo,
    tuning: [...staff.tuning]
      .reverse()
      .map((p) => ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][p % 12])
      .join(" "),
    capo: staff.capo,
  };
}
