import { tieCrossesRepeat } from "./repeats";
import { model } from "@coderline/alphatab";

function voiceTicks(voice: model.Voice) {
  return voice.beats.reduce(
    (total, b) =>
      total +
      (b.graceType !== model.GraceType.None
        ? 0
        : b.isFullBarRest
          ? voice.bar.masterBar.calculateDuration()
          : ((960 * 4) / b.duration) *
            (2 - 1 / 2 ** b.dots) *
            (b.tupletNumerator > 0 ? b.tupletDenominator / b.tupletNumerator : 1)),
    0,
  );
}
export function tiePredecessor(note: model.Note): model.Note | undefined {
  const beat = note.beat,
    staff = beat.voice.bar.staff;
  const b = beat.voice.bar.index,
    v = beat.voice.index;
  const previous =
    beat.index > 0 ? beat.voice.beats[beat.index - 1] : staff.bars[b - 1]?.voices[v]?.beats.at(-1);
  if (
    !previous ||
    tieCrossesRepeat(previous.voice.bar.masterBar, beat.voice.bar.masterBar) ||
    previous.isRest ||
    previous.graceType !== model.GraceType.None ||
    beat.graceType !== model.GraceType.None
  )
    return;
  if (
    previous.voice.bar !== beat.voice.bar &&
    voiceTicks(previous.voice) < previous.voice.bar.masterBar.calculateDuration()
  )
    return;
  return previous.notes.find(
    (n) => n.string === note.string && n.fret === note.fret && n.realValue === note.realValue,
  );
}
/** Rebuild links before JSON rehydration, which otherwise copies the old tie origin's pitch. */
export function repairTies(score: model.Score) {
  const originalOrigins = new Map<model.Note, model.Note | null>();
  for (const track of score.tracks)
    for (const staff of track.staves)
      for (const bar of staff.bars)
        for (const voice of bar.voices)
          for (const beat of voice.beats)
            for (const note of beat.notes) originalOrigins.set(note, note.tieOrigin);
  for (const track of score.tracks)
    for (const staff of track.staves) {
      const previous = new Map<number, model.Beat>();
      for (const bar of staff.bars) {
        for (const v of previous.keys()) if (!bar.voices[v]) previous.delete(v);
        for (const [v, voice] of bar.voices.entries()) {
          for (const beat of voice.beats) {
            for (const note of beat.notes) {
              note.tieOrigin = null;
              note.tieDestination = null;
            }
            const before = previous.get(v);
            for (const note of beat.notes) {
              if (!note.isTieDestination) continue;
              const origin = before?.notes.find(
                (n) =>
                  n.string === note.string &&
                  n.fret === note.fret &&
                  n.realValue === note.realValue,
              );
              const contiguous =
                before &&
                (before.voice.bar === bar ||
                  voiceTicks(before.voice) >= before.voice.bar.masterBar.calculateDuration());
              if (
                !origin ||
                (!!before && tieCrossesRepeat(before.voice.bar.masterBar, bar.masterBar)) ||
                (!!originalOrigins.get(note) && originalOrigins.get(note) !== origin) ||
                !contiguous ||
                before?.isRest ||
                beat.graceType !== model.GraceType.None ||
                before?.graceType !== model.GraceType.None
              )
                note.isTieDestination = false;
              else {
                note.tieOrigin = origin;
                origin.tieDestination = note;
              }
            }
            previous.set(v, beat);
          }
          if (!voice.beats.length) previous.delete(v);
        }
      }
    }
}
export function invalidTies(score: model.Score) {
  return score.tracks.some((t) =>
    t.staves.some((s) =>
      s.bars.some((b) =>
        b.voices.some((v) =>
          v.beats.some((beat) =>
            beat.notes.some(
              (n) =>
                n.isTieDestination && (!tiePredecessor(n) || n.tieOrigin !== tiePredecessor(n)),
            ),
          ),
        ),
      ),
    ),
  );
}
