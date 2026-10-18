import type { model } from "@coderline/alphatab";
export type Score = model.Score;
export type PracticeSettings = {
  speed: number;
  tick: number;
  loop: { start: number; end: number; enabled: boolean };
  metronome: boolean;
  countIn: boolean;
  volume: number;
  follow: boolean;
  notation: "tab" | "score" | "both";
  zoom: number;
};
export const defaultPractice = (): PracticeSettings => ({
  speed: 1,
  tick: 0,
  loop: { start: 1, end: 4, enabled: false },
  metronome: false,
  countIn: true,
  volume: 0.7,
  follow: true,
  notation: "tab",
  zoom: 1,
});
export type Marker = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type ReferenceData = {
  file: Blob;
  mime: string;
  markers: Marker[];
  bpm: number;
  numerator: number;
  denominator: number;
  confirmed: boolean;
};
export type AudioPair = {
  file: Blob;
  name: string;
  duration: number;
  anchors: number[];
  confirmed: boolean;
  alignment?: {
    algorithm: "chroma-dtw-v1";
    similarity: number;
    quality: number[];
    warnings: string[];
    edited: number[];
  };
};
export type Piece = {
  id: string;
  title: string;
  kind: "score" | "reference" | "chords";
  sourceName: string;
  createdAt: number;
  updatedAt: number;
  scoreJson?: string;
  recognition?: import("./review").Recognition;
  original?: Blob;
  reference?: ReferenceData;
  audio?: AudioPair;
  warnings: string[];
  suggestedFingering: boolean;
  practice: PracticeSettings;
  composer: string;
  measures: number;
  bpm: number;
  tuning: string;
  capo: number;
  demo?: boolean;
};
export type TimelineBar = {
  index: number;
  occurrence: number;
  startTick: number;
  endTick: number;
  startMs: number;
  endMs: number;
  numerator: number;
  denominator: number;
  tempo: number;
};
export type Snapshot = {
  playing: boolean;
  ready: boolean;
  tick: number;
  endTick: number;
  time: number;
  duration: number;
  bar: number;
  beat: number;
  tempo: number;
  counting: boolean;
  mode: "synth" | "audio";
};
export const initialSnapshot: Snapshot = {
  playing: false,
  ready: false,
  tick: 0,
  endTick: 0,
  time: 0,
  duration: 0,
  bar: 0,
  beat: 1,
  tempo: 80,
  counting: false,
  mode: "synth",
};
export const formatTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
