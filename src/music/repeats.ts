import { midi, model, Settings } from "@coderline/alphatab";
const D = model.Direction;
export const jumpChoices = [
  [D.JumpDaCapo, "D.C. 回到開頭"],
  [D.JumpDaCapoAlFine, "D.C. al Fine 回頭至 Fine"],
  [D.JumpDalSegno, "D.S. 回到 Segno"],
  [D.JumpDalSegnoAlFine, "D.S. al Fine 回 Segno 至 Fine"],
] as const;
function directionIssue(score: model.Score) {
  const entries = score.masterBars.flatMap((b, i) =>
    [...(b.directions ?? [])].map((d) => ({ d, i })),
  );
  const allowed = new Set<number>([D.TargetFine, D.TargetSegno, ...jumpChoices.map(([d]) => d)]);
  if (entries.some((e) => !allowed.has(e.d)))
    return "目前校對支援 D.C.／D.S.／Fine／Segno；Coda 等其他跳轉請先展開小節。";
  const jumps = entries.filter((e) => jumpChoices.some(([d]) => d === e.d));
  if (!entries.length) return "";
  if (jumps.length !== 1) return "跳轉譜請設定且僅設定一個 D.C. 或 D.S.。";
  if (score.masterBars.some((b) => b.isRepeatStart || b.repeatCount || b.alternateEndings))
    return "D.C.／D.S. 暫不與反覆或房號混用，請先展開其中一種順序。";
  const jump = jumps[0],
    segnos = entries.filter((e) => e.d === D.TargetSegno),
    fines = entries.filter((e) => e.d === D.TargetFine);
  if (segnos.length > 1 || fines.length > 1) return "Segno 與 Fine 各只能設定一處。";
  const ds = jump.d === D.JumpDalSegno || jump.d === D.JumpDalSegnoAlFine;
  if (ds && (segnos.length !== 1 || segnos[0].i >= jump.i))
    return "D.S. 之前需要一個 Segno 回跳目標。";
  const fine = jump.d === D.JumpDaCapoAlFine || jump.d === D.JumpDalSegnoAlFine;
  if (fine && (fines.length !== 1 || fines[0].i >= jump.i || fines[0].i < (ds ? segnos[0].i : 0)))
    return "al Fine 需要在回跳目標與跳轉小節之間設定 Fine。";
  if (!fine && fines.length) return "有 Fine 時請選擇 al Fine 跳轉，避免提早或錯誤結束。";
  return "";
}
/** Bound repeat depth and reject ambiguous combinations before native MIDI expansion. */
export function repeatIssue(score: model.Score): string {
  const directions = directionIssue(score);
  if (directions) return directions;
  let depth = 0,
    maxDepth = 0;
  for (const b of score.masterBars) {
    if (b.isRepeatStart) maxDepth = Math.max(maxDepth, ++depth);
    if (b.repeatCount) depth = Math.max(0, depth - 1);
  }
  if (maxDepth > 1) {
    if (maxDepth > 2) return "巢狀反覆目前最多兩層。";
    if (score.masterBars.some((b) => b.alternateEndings))
      return "巢狀反覆暫不混用一、二房，請先展開房號。";
    if (depth) return "巢狀反覆尚未閉合，請補上反覆結束。";
    if (
      score.masterBars.some(
        (b) =>
          b.repeatCount &&
          (!Number.isInteger(b.repeatCount) || b.repeatCount < 2 || b.repeatCount > 4),
      )
    )
      return "反覆總遍數需為 2–4。";
    return "";
  }
  let start = -1,
    first = -1,
    secondAllowed = false;
  for (const [i, b] of score.masterBars.entries()) {
    if (b.isRepeatStart) {
      if (start >= 0) return "暫不支援巢狀反覆，請拆成獨立段落。";
      start = i;
      secondAllowed = false;
    }
    if (![0, 1, 2].includes(b.alternateEndings))
      return "房號請選無、一房或二房；多房與混合房號需先整理。";
    if (b.alternateEndings === 1) {
      if (first < 0) first = i;
      if (start < 0) start = 0;
    } else if (first >= 0) return "一房需連續，且最後一小節必須標示反覆結束。";
    if (b.alternateEndings === 2 && !secondAllowed) return "二房必須接在一房的反覆結束之後。";
    if (b.alternateEndings !== 2 && secondAllowed) secondAllowed = false;
    if (b.repeatCount) {
      if (!Number.isInteger(b.repeatCount) || b.repeatCount < 2 || b.repeatCount > 4)
        return "反覆總遍數需為 2–4。";
      if (b.alternateEndings === 2) return "二房內不支援另一個反覆結束。";
      if (first >= 0 && b.repeatCount !== 2) return "一、二房目前限總共演奏兩遍。";
      if (first >= 0 && score.masterBars[i + 1]?.alternateEndings !== 2)
        return "一房反覆結束後需要二房。";
      secondAllowed = first >= 0;
      first = -1;
      start = -1;
    }
  }
  if (start >= 0 || first >= 0) return "反覆起點或一房尚未有反覆結束，請補上或取消。";
  return "";
}
export function repeatOrder(score: model.Score): number[] {
  if (repeatIssue(score)) return [];
  const g = new midi.MidiFileGenerator(
    score,
    new Settings(),
    new midi.AlphaSynthMidiFileHandler(new midi.MidiFile()),
  );
  g.generate();
  return g.tickLookup.masterBars.map((b) => b.masterBar.index + 1);
}
/** A tie across a branch is ambiguous: require explicit re-articulation during review. */
export function tieCrossesRepeat(a: model.MasterBar, b: model.MasterBar) {
  return (
    a !== b &&
    (b.isRepeatStart ||
      a.repeatCount > 0 ||
      a.alternateEndings !== b.alternateEndings ||
      [...(a.directions ?? [])].some(
        (d) => jumpChoices.some(([j]) => j === d) || d === D.TargetFine,
      ) ||
      b.directions?.has(D.TargetSegno))
  );
}
