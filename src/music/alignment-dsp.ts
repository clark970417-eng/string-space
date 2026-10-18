import FFT from "fft.js";
import type { AlignmentNote } from "./alignment-score";
export type AlignmentResult = {
  anchors: number[];
  quality: number[];
  similarity: number;
  warnings: string[];
  hop: number;
  algorithm: "chroma-dtw-v1";
};
export type AlignmentInput = {
  samples: Float32Array;
  sampleRate: number;
  notes: AlignmentNote[];
  boundaries: number[];
};
type Features = { data: Float32Array; energy: Float32Array; frames: number };
const BINS = 12,
  RATE = 11025,
  SIZE = 4096;
function normalize(values: Float32Array, offset: number) {
  let sum = 0;
  for (let k = 0; k < BINS; k++) sum += values[offset + k] ** 2;
  sum = Math.sqrt(sum);
  if (sum > 0) for (let k = 0; k < BINS; k++) values[offset + k] /= sum;
}
function audioFeatures(
  input: AlignmentInput,
  hop: number,
  progress: (n: number) => void,
): Features {
  const { samples, sampleRate } = input,
    duration = samples.length / sampleRate;
  const frames = Math.ceil(duration / hop),
    data = new Float32Array(frames * BINS),
    energy = new Float32Array(frames);
  const fft = new FFT(SIZE),
    spectrum = fft.createComplexArray(),
    window = new Float64Array(SIZE),
    signal = new Float64Array(SIZE);
  for (let k = 0; k < SIZE; k++) window[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (SIZE - 1));
  const pitch = new Int16Array(SIZE / 2),
    weights = new Float64Array(SIZE / 2);
  for (let k = 1; k < SIZE / 2; k++) {
    const frequency = (k * RATE) / SIZE,
      midi = 69 + 12 * Math.log2(frequency / 440),
      rounded = Math.round(midi);
    if (frequency >= 65 && frequency <= 2600) {
      pitch[k] = (rounded + 1200) % 12;
      weights[k] = Math.cos(Math.PI * (midi - rounded)) ** 2 / frequency ** 0.15;
    }
  }
  let maxEnergy = 0;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let k = 0; k < SIZE; k++) {
      const p = (i * hop + (k - SIZE / 2) / RATE) * sampleRate,
        a = Math.floor(p),
        f = p - a;
      const value =
        a >= 0 && a + 1 < samples.length ? samples[a] * (1 - f) + samples[a + 1] * f : 0;
      signal[k] = value * window[k];
      sum += value * value;
    }
    energy[i] = Math.sqrt(sum / SIZE);
    maxEnergy = Math.max(maxEnergy, energy[i]);
    fft.realTransform(spectrum, signal);
    for (let k = 1; k < SIZE / 2; k++)
      if (weights[k])
        data[i * BINS + pitch[k]] += Math.hypot(spectrum[k * 2], spectrum[k * 2 + 1]) * weights[k];
    normalize(data, i * BINS);
    if (i % 100 === 0) progress(0.05 + (0.4 * i) / frames);
  }
  if (maxEnergy < 0.00002) throw Error("音檔沒有足夠可辨識的聲音，請檢查錄音或改用其他檔案。");
  for (let i = 0; i < frames; i++)
    if (energy[i] < Math.max(0.00001, maxEnergy * 0.02)) {
      data.fill(0, i * BINS, (i + 1) * BINS);
      energy[i] = 0;
    }
  return { data, energy, frames };
}
function scoreFeatures(notes: AlignmentNote[], duration: number, hop: number): Features {
  const frames = Math.ceil(duration / hop),
    data = new Float32Array(frames * BINS),
    energy = new Float32Array(frames);
  for (const n of notes) {
    const from = Math.max(0, Math.ceil(n.start / hop)),
      to = Math.min(frames, Math.ceil(n.end / hop));
    for (let i = from; i < to; i++) {
      const offset = i * BINS,
        p = (n.pitch + 1200) % 12,
        w = Math.sqrt(n.velocity / 127);
      data[offset + p] += w;
      data[offset + ((p + 7) % 12)] += 0.12 * w;
      energy[i] = 1;
    }
  }
  for (let i = 0; i < frames; i++) normalize(data, i * BINS);
  return { data, energy, frames };
}
const similarity = (x: Features, i: number, y: Features, j: number) => {
  if (!x.energy[i]) return y.energy[j] ? 0.1 : 1;
  if (!y.energy[j]) return 0;
  let dot = 0;
  for (let k = 0; k < BINS; k++) dot += x.data[i * BINS + k] * y.data[j * BINS + k];
  return Math.min(1, dot);
};
/** Subsequence DTW with (1,1), (1,2), (2,1) steps: free intro/outro, bounded local stretch. */
export function alignAudio(
  input: AlignmentInput,
  progress: (fraction: number) => void = () => {},
): AlignmentResult {
  const { samples, sampleRate, notes, boundaries } = input,
    duration = samples.length / sampleRate,
    scoreDuration = boundaries.at(-1) ?? 0;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 600 ||
    scoreDuration <= 0 ||
    scoreDuration > 600
  )
    throw Error("自動對齊目前限音檔與樂譜各 10 分鐘內，請裁切練習段落。");
  if (notes.length < 6 || new Set(notes.map((n) => n.pitch % 12)).size < 3)
    throw Error("音符或音高變化不足，請先校對完整旋律。");
  if (duration < scoreDuration * 0.45)
    throw Error("音檔過短，可能不是完整演奏或反覆順序不同。請檢查檔案與樂譜。");
  const hop = Math.max(0.08, Math.sqrt((duration * scoreDuration) / 5_000_000));
  const x = scoreFeatures(notes, scoreDuration, hop),
    y = audioFeatures(input, hop, progress),
    n = x.frames,
    m = y.frames;
  let changes = 0,
    last = -1;
  for (let i = 0; i < n; i++)
    if (x.energy[i]) {
      if (last >= 0) {
        let dot = 0;
        for (let k = 0; k < BINS; k++) dot += x.data[i * BINS + k] * x.data[last * BINS + k];
        if (dot < 0.92) changes++;
      }
      last = i;
    }
  if (changes < 3)
    throw Error("樂譜音高輪廓變化不足，無法唯一定位錄音。請使用更完整的旋律或手動校時。");
  if (n < 4 || m < 4 || n * m > 5_200_000) throw Error("分析資料量過大，請裁切較短的練習段落。");
  const trace = new Uint8Array(n * m),
    costRow = new Float32Array(m),
    lastCost = new Float32Array(m);
  let prev = new Float64Array(m).fill(Infinity),
    prev2 = new Float64Array(m).fill(Infinity),
    row = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    row.fill(Infinity);
    for (let j = 0; j < m; j++) costRow[j] = 1 - similarity(x, i, y, j);
    for (let j = 0; j < m; j++) {
      const c = costRow[j];
      if (i === 0) {
        row[j] = c;
        trace[j] = 4;
        continue;
      }
      let best = j > 0 ? prev[j - 1] + c : Infinity,
        step = 1;
      const slow = j > 1 ? prev[j - 2] + (c + costRow[j - 1]) * 0.5 + 0.025 : Infinity;
      if (slow < best) {
        best = slow;
        step = 2;
      }
      const fast = i > 1 && j > 0 ? prev2[j - 1] + c + lastCost[j] + 0.025 : Infinity;
      if (fast < best) {
        best = fast;
        step = 3;
      }
      row[j] = best;
      trace[i * m + j] = step;
    }
    lastCost.set(costRow);
    [prev2, prev, row] = [prev, row, prev2];
    if (i % 50 === 0) progress(0.5 + (0.43 * i) / n);
  }
  let end = 0;
  for (let j = 1; j < m; j++) if (prev[j] < prev[end]) end = j;
  if (!Number.isFinite(prev[end]))
    throw Error("找不到連續的樂譜對應，請檢查演奏順序或改用手動校時。");
  const mapping = new Float64Array(n).fill(NaN),
    qualityFrames = new Float32Array(n);
  let i = n - 1,
    j = end;
  while (i >= 0 && j >= 0) {
    mapping[i] = j * hop;
    qualityFrames[i] = similarity(x, i, y, j);
    const step = trace[i * m + j];
    if (step === 4) break;
    if (step === 3) {
      mapping[i - 1] = (j - 0.5) * hop;
      qualityFrames[i - 1] = similarity(x, i - 1, y, Math.max(0, j - 1));
      i -= 2;
      j--;
    } else if (step === 2) {
      i--;
      j -= 2;
    } else {
      i--;
      j--;
    }
  }
  if (!Number.isFinite(mapping[0])) throw Error("音檔無法涵蓋完整樂譜，請檢查選取範圍。");
  let match = 0,
    count = 0;
  for (let k = 0; k < n; k++)
    if (x.energy[k]) {
      match += qualityFrames[k];
      count++;
    }
  const mean = match / Math.max(1, count);
  if (mean < 0.56)
    throw Error(
      "音檔與樂譜的音高相似度不足，未產生可用對齊。請檢查調弦、移調、音檔或辨識結果，也可手動校時。",
    );
  const mapped = (second: number) => {
    const f = Math.max(0, Math.min(n - 1, second / hop)),
      a = Math.floor(f),
      b = Math.min(n - 1, a + 1);
    if (second >= scoreDuration) return Math.min(duration, mapping[n - 1] + hop);
    return Math.max(0, mapping[a] + (mapping[b] - mapping[a]) * (f - a));
  };
  const anchors = boundaries.map(mapped),
    quality: number[] = [];
  for (let b = 0; b < boundaries.length - 1; b++) {
    let sum = 0,
      total = 0;
    for (
      let k = Math.floor(boundaries[b] / hop);
      k < Math.min(n, Math.ceil(boundaries[b + 1] / hop));
      k++
    )
      if (x.energy[k]) {
        sum += qualityFrames[k];
        total++;
      }
    quality.push(total ? sum / total : 0);
  }
  if (anchors.some((t, k) => !Number.isFinite(t) || (k > 0 && t <= anchors[k - 1])))
    throw Error("部分小節無法形成遞增的時間點，請人工校正或縮短樂譜後重試。");
  const warnings: string[] = [];
  if (quality.some((q) => q < 0.7))
    warnings.push("部分小節配對較弱或只有休止符，請優先試聽標記的小節。");
  let competitor = Infinity;
  const exclusion = Math.max(1, Math.round(((anchors.at(-1)! - anchors[0]) * 0.5) / hop));
  for (let k = 0; k < m; k++)
    if (Math.abs(k - end) > exclusion) competitor = Math.min(competitor, prev[k]);
  if (Number.isFinite(competitor) && (competitor - prev[end]) / n < 0.06)
    warnings.push("錄音中有相似或重複段落，可能存在另一個對齊位置；請核對開頭與結尾。");
  warnings.push(
    "這是音高特徵的對齊候選，仍需預覽確認。移調、漏彈、額外反覆及密集伴奏可能造成錯配。",
  );
  progress(1);
  return {
    anchors: anchors.map((t) => Math.round(t * 100) / 100),
    quality,
    similarity: mean,
    warnings,
    hop,
    algorithm: "chroma-dtw-v1",
  };
}
