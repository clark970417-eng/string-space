import { alignAudio, type AlignmentInput } from "./alignment-dsp";
self.onmessage = (event: MessageEvent<AlignmentInput>) => {
  try {
    const result = alignAudio(event.data, (value) => self.postMessage({ type: "progress", value }));
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", message: (error as Error).message });
  }
};
