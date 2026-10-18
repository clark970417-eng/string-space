import type { AlignmentInput, AlignmentResult } from "./alignment-dsp";
import type { AlignmentScore } from "./alignment-score";
export async function automaticAlignment(
  file: Blob,
  score: AlignmentScore,
  signal: AbortSignal,
  progress: (label: string) => void,
): Promise<AlignmentResult> {
  signal.throwIfAborted();
  if (file.size > 100 * 1024 * 1024) throw Error("音檔請小於 100 MB。");
  progress("在本機解碼音檔…");
  const context = new AudioContext();
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw Error("無法解碼這個音檔，請改用可播放的 WAV、MP3 或 M4A。");
  } finally {
    await context.close();
  }
  signal.throwIfAborted();
  if (buffer.duration > 600 || score.duration > 600)
    throw Error("自動對齊目前限音檔與樂譜各 10 分鐘內，請先裁切練習段落。");
  // Downmix/resample before transfer, so the worker never holds the full stereo recording.
  const sampleRate = 11025,
    samples = new Float32Array(Math.ceil(buffer.duration * sampleRate));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c),
      ratio = buffer.sampleRate / sampleRate;
    for (let i = 0; i < samples.length; i++) {
      const p = i * ratio,
        a = Math.floor(p),
        f = p - a;
      samples[i] += ((data[a] ?? 0) * (1 - f) + (data[a + 1] ?? 0) * f) / buffer.numberOfChannels;
    }
  }
  signal.throwIfAborted();
  const worker = new Worker(new URL("./alignment.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, result?: AlignmentResult) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DOMException("已取消自動對齊", "AbortError"));
    const timer = setTimeout(
      () => finish(Error("自動對齊逾時，請改用較短的音檔或手動校時。")),
      120000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(Error("本機音訊分析引擎載入失敗，請重試或使用手動校時。"));
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === "progress")
        progress(`分析音高與配對節奏… ${Math.round(data.value * 100)}%`);
      else if (data.type === "error") finish(Error(data.message));
      else if (data.type === "result") finish(undefined, data.result);
    };
    const input: AlignmentInput = {
      samples,
      sampleRate,
      notes: score.notes,
      boundaries: score.boundaries,
    };
    worker.postMessage(input, [samples.buffer]);
  });
}
