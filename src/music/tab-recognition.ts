import { createWorker, PSM } from "tesseract.js";
import { importer, model } from "@coderline/alphatab";
import type { Piece, ReferenceData } from "./model";
import { repeatSigns, endingBrackets } from "./tab-repeats";
import { changeScore } from "./review";
import { defaultPractice } from "./model";
import { pixels, staffGroups, digitRegions, rhythmCandidate } from "./tab-image";
import {
  rhythmShapes,
  blockRestCandidates,
  hasTieArc,
  boundaryTieDirections,
  symbolTemplates,
  restCandidates,
  augmentationDots,
  applyTuplets,
  rhythmTex,
  type RhythmEvent,
} from "./tab-rhythm";
export type TabMeasure = {
  page: number;
  image: string;
  notes: number;
  messages: string[];
  boundaryFrom?: number;
  bounds?: { x: number; y: number; width: number; height: number };
};
export type TabReview = {
  measures: TabMeasure[];
  rhythmReviewed: string[];
  setupConfirmed: boolean;
};
export function parsePages(spec: string, total: number) {
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(spec)) throw Error("頁碼請輸入例如 1-3 或 1,3。");
  const values = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b = a] = part.split("-").map(Number);
    if (a < 1 || b < a || b > total || b - a > 7) throw Error("頁碼超出原譜或一次超過 8 頁。");
    for (let i = a; i <= b; i++) values.add(i);
  }
  if (values.size > 8) throw Error("一次最多辨識 8 頁。");
  return [...values].sort((a, b) => a - b);
}
async function* pages(
  source: ReferenceData,
  spec: string,
  signal: AbortSignal,
): AsyncGenerator<{ canvas: HTMLCanvasElement; page: number }> {
  if (source.mime === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    const task = pdfjs.getDocument({
      data: new Uint8Array(await source.file.arrayBuffer()),
      isEvalSupported: false,
    });
    const abort = () => void task.destroy();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const pdf = await task.promise;
      for (const n of parsePages(spec, pdf.numPages)) {
        signal.throwIfAborted();
        const page = await pdf.getPage(n);
        const size = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(3, 2400 / size.width, 3400 / size.height),
        });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        yield { canvas, page: n };
      }
    } finally {
      signal.removeEventListener("abort", abort);
      await task.destroy();
    }
  } else {
    const bitmap = await createImageBitmap(source.file);
    try {
      const scale = Math.min(1, 2600 / bitmap.width, 3400 / bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      yield { canvas, page: 1 };
    } finally {
      bitmap.close();
    }
  }
}
export async function recognizeTab(
  source: Piece,
  spec: string,
  signal: AbortSignal,
  progress: (s: string) => void,
): Promise<Piece> {
  const original = source.reference!;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let terminated = false;
  const stop = () => {
    terminated = true;
    if (worker) void worker.terminate();
  };
  signal.addEventListener("abort", stop, { once: true });
  const bars: string[] = [];
  const repeats: { start: boolean; count: number; ending: number }[] = [];
  const ties: { bar: number; beat: number; string: number }[] = [];
  const measures: TabMeasure[] = [];
  let outgoing:
    | { page: number; bar: number; notes: { string: number; fret: number; directions: number[] }[] }
    | undefined;
  let count = 0;
  let recognizedEvents = 0;
  try {
    progress("載入本機數字辨識資源（首次載入較久）…");
    // Fail before spawning OCR if its same-origin resources cannot be loaded.
    await Promise.all(
      [
        "/ocr/worker.min.js",
        "/ocr/eng.traineddata.gz",
        "/ocr/core/tesseract-core-lstm.wasm.js",
      ].map(async (url) => {
        try {
          const r = await fetch(url, {
            method: "HEAD",
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          });
          if (!r.ok) throw Error();
        } catch {
          signal.throwIfAborted();
          throw Error(
            "數字辨識資源載入失敗。請確認網站的 OCR 資源已完整安裝，再重試；也可手動輸入。",
          );
        }
      }),
    );
    let fail!: (e: Error) => void;
    const failed = new Promise<never>((_, reject) => {
      fail = reject;
    });
    const abortInit = () => fail(new DOMException("已取消辨識", "AbortError"));
    signal.addEventListener("abort", abortInit, { once: true });
    const timer = setTimeout(() => fail(Error("辨識引擎載入逾時，請重新整理或手動輸入。")), 30000);
    let initEnded = false;
    const init = createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr",
      workerBlobURL: false,
      errorHandler: () => fail(Error("數字辨識引擎載入或執行失敗，請重試或手動輸入。")),
    }).then((w) => {
      if (initEnded || signal.aborted) void w.terminate();
      return w;
    });
    try {
      worker = await Promise.race([init, failed]);
    } finally {
      initEnded = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abortInit);
    }
    signal.throwIfAborted();
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: PSM.SINGLE_WORD,
    });
    progress("載入本機節奏符號範本…");
    let templates: Awaited<ReturnType<typeof symbolTemplates>>;
    try {
      templates = await symbolTemplates();
    } catch {
      throw Error("節奏符號字型載入失敗，請確認本機字型資源後重試，或手動輸入節奏。");
    }
    signal.throwIfAborted();
    for await (const { canvas, page } of pages(original, spec, signal)) {
      signal.throwIfAborted();
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const p = pixels(ctx.getImageData(0, 0, canvas.width, canvas.height));
      const staves = staffGroups(p);
      if (!staves.length)
        throw Error(
          `第 ${page} 頁找不到清楚、水平且等距的六條譜線。請裁正圖片或改用手動輸入；不會略過這一頁。`,
        );
      for (const staff of staves) {
        const shapes = rhythmShapes(p, staff);
        const signs = repeatSigns(p, staff, shapes);
        const endings = new Map<number, number>();
        const endingWarnings = new Map<number, string>();
        for (const bracket of endingBrackets(p, staff)) {
          const crop = document.createElement("canvas");
          crop.width = Math.ceil(staff.gap * 1.3);
          crop.height = Math.ceil(staff.gap * 0.9);
          crop
            .getContext("2d")!
            .drawImage(
              canvas,
              bracket.left + staff.gap * 0.15,
              bracket.y + staff.gap * 0.12,
              crop.width,
              crop.height,
              0,
              0,
              crop.width,
              crop.height,
            );
          const result = await worker.recognize(crop.toDataURL());
          signal.throwIfAborted();
          const label = result.data.text.trim();
          for (let k = bracket.first; k <= bracket.last; k++) {
            if (/^[12]$/.test(label) && result.data.confidence >= 60) endings.set(k, +label);
            else endingWarnings.set(k, "可見房號括線，但未可靠讀出 1 或 2；請手動設定房號與範圍。");
          }
        }
        const rests = [
          ...restCandidates(p, staff, shapes, templates, []),
          ...blockRestCandidates(p, staff),
        ];
        const glyphs = digitRegions(p, staff).filter(
          (g) =>
            !rests.some(
              (r) =>
                g.x < r.shape.x + r.shape.w &&
                g.x + g.w > r.shape.x &&
                g.y < r.shape.y + r.shape.h &&
                g.y + g.h > r.shape.y,
            ),
        );
        const found: { x: number; string: number; fret: number; confidence: number }[] = [];
        const missed: number[] = [];
        for (const glyph of glyphs) {
          signal.throwIfAborted();
          if (++count > 400) throw Error("候選數字超過 400 個，請分頁或裁成較短的段落。");
          progress(`第 ${page} 頁 · 檢查第 ${count} 個品格數字…`);
          const crop = document.createElement("canvas");
          const scale = 3;
          crop.width = (glyph.w + 14) * scale;
          crop.height = (glyph.h + 14) * scale;
          const c = crop.getContext("2d")!;
          c.fillStyle = "white";
          c.fillRect(0, 0, crop.width, crop.height);
          c.drawImage(
            canvas,
            glyph.x,
            glyph.y,
            glyph.w,
            glyph.h,
            7 * scale,
            7 * scale,
            glyph.w * scale,
            glyph.h * scale,
          );
          // Erase staff-only pixels while preserving vertical strokes crossing the staff.
          const line = staff.lines[glyph.string - 1];
          for (let x = 0; x < glyph.w; x++)
            if (
              !p.ink[(line - 3) * p.width + glyph.x + x] &&
              !p.ink[(line + 3) * p.width + glyph.x + x]
            )
              c.fillRect((x + 7) * scale, (line - glyph.y + 5) * scale, scale, 5 * scale);
          let { data } = await worker.recognize(crop.toDataURL());
          signal.throwIfAborted();
          if (!/^\d{1,2}$/.test(data.text.trim())) {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
            data = (await worker.recognize(crop.toDataURL())).data;
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD });
          }
          const text = data.text.trim();
          if (/^\d{1,2}$/.test(text) && +text <= 24)
            found.push({
              x: glyph.x + glyph.w / 2,
              string: glyph.string,
              fret: +text,
              confidence: data.confidence,
            });
          else missed.push(glyph.x);
        }
        let previous: { x: number; notes: typeof found } | undefined;
        for (let b = 0; b < staff.bars.length - 1; b++) {
          const left = staff.bars[b],
            right = staff.bars[b + 1];
          const notes = found.filter((n) => n.x > left && n.x < right);
          const groups: (typeof notes)[] = [];
          for (const n of notes) {
            const g = groups.find((g) => Math.abs(g[0].x - n.x) < staff.gap * 0.45);
            if (g) g.push(n);
            else groups.push([n]);
          }
          const messages: string[] = [];
          const mark = {
            start: signs[b].start,
            count: signs[b + 1].end ? 2 : 0,
            ending: endings.get(b) ?? 0,
          };
          repeats.push(mark);
          if (mark.start) messages.push("雙小節線右側成對圓點：反覆起點候選。");
          if (mark.count)
            messages.push("雙小節線左側成對圓點：反覆結束候選；總遍數暫設 2，請校對。");
          if (mark.ending)
            messages.push(
              `原圖括線與數字 ${mark.ending}：${mark.ending === 1 ? "一" : "二"}房候選，請核對涵蓋小節。`,
            );
          if (endingWarnings.has(b)) messages.push(endingWarnings.get(b)!);
          let boundaryFrom: number | undefined;
          if (missed.some((x) => x > left && x < right))
            messages.push("有圖形未能讀成 0–24 品；可能漏音或演奏記號，請對照原圖補正。");
          if (notes.some((n) => n.confidence < 80))
            messages.push("部分品格 OCR 信心較低，請逐一檢查一位／兩位數。");
          if (groups.some((g) => new Set(g.map((n) => n.string)).size !== g.length))
            throw Error("同一拍同一弦有多個數字，無法可靠分組；請裁成單行六線譜後重試。");
          const events: RhythmEvent[] = groups.map((g) => {
            const r = rhythmCandidate(p, staff, g[0].x);
            return {
              x: g[0].x,
              duration: r.duration,
              dots: 0,
              tuplet: 0,
              tex: `(${g.map((n) => `${n.fret}.${n.string}`).join(" ")})`,
              evidence: [r.evidence],
            };
          });
          for (const r of rests.filter((r) => r.shape.x > left && r.shape.x + r.shape.w < right)) {
            const x = r.shape.x + r.shape.w / 2;
            if (events.some((e) => Math.abs(e.x - x) < staff.gap * 0.55)) {
              messages.push("休止符候選與音符重疊，未自動插入；請檢查多聲部或誤辨。");
              continue;
            }
            events.push({
              x,
              duration: r.duration,
              dots: 0,
              tuplet: 0,
              tex: "r",
              evidence: [
                `符號外形符合${r.duration === 1 ? "全休止符（單獨時為全小節休止）" : r.duration === 2 ? "二分休止符" : `${r.duration} 分休止符`}候選；請對照原圖`,
              ],
            });
          }
          recognizedEvents += events.length;
          events.sort((a, b) => a.x - b.x);
          events.forEach((e, i) => {
            const rest = rests.find((r) => Math.abs(r.shape.x + r.shape.w / 2 - e.x) < 1);
            const anchors = rest
              ? [rest.shape.y + rest.shape.h / 2]
              : [
                  ...groups
                    .find((g) => Math.abs(g[0].x - e.x) < 1)!
                    .map((n) => staff.lines[n.string - 1]),
                  staff.lines[5] + staff.gap * 0.65,
                  staff.lines[0] - staff.gap * 0.65,
                ];
            e.dots = augmentationDots(staff, shapes, e.x, anchors, events[i + 1]?.x ?? right);
            if (e.dots)
              e.evidence.push(`右側 ${e.dots} 個附點候選：時值 × ${e.dots === 1 ? "1.5" : "1.75"}`);
          });
          applyTuplets(
            p,
            staff,
            shapes.filter((s) => s.x > left && s.x + s.w < right),
            templates,
            events,
            messages,
          );
          events.forEach((e, i) => {
            const current = groups.find((g) => Math.abs(g[0].x - e.x) < 1) ?? [];
            if (
              b === 0 &&
              i === 0 &&
              outgoing &&
              (page === outgoing.page || page === outgoing.page + 1) &&
              !missed.some((x) => x < e.x)
            ) {
              for (const n of current) {
                const incoming = boundaryTieDirections(p, staff, e.x, n.string, "in");
                if (
                  outgoing.notes.some(
                    (o) =>
                      o.string === n.string &&
                      o.fret === n.fret &&
                      o.directions.some((d) => incoming.includes(d)),
                  )
                ) {
                  ties.push({ bar: bars.length, beat: i, string: 7 - n.string });
                  boundaryFrom = outgoing.bar;
                  e.evidence.push(
                    `${n.string} 弦 ${n.fret} 品：前列末端與本列開頭均有同向半弧線，${page === outgoing.page ? "跨譜列" : "跨頁"}延音候選；請對照兩端原圖確認`,
                  );
                }
              }
            }
            if (previous && current.length)
              for (const n of current) {
                if (
                  previous.notes.some((o) => o.string === n.string && o.fret === n.fret) &&
                  hasTieArc(p, staff, previous.x, e.x, n.string)
                ) {
                  ties.push({ bar: bars.length, beat: i, string: 7 - n.string });
                  e.evidence.push(
                    `${n.string} 弦 ${n.fret} 品：可見弧線連到前一同弦同音，延音線候選；請核對是否持續而非重新撥弦`,
                  );
                }
              }
            previous = { x: e.x, notes: current };
          });
          if (!events.length) previous = undefined;
          events.forEach((e, i) => messages.push(`原圖事件 ${i + 1}：${e.evidence.join("；")}`));
          if (!events.length)
            messages.push("本小節沒有讀到音符或可靠休止符，暫放全休止符；請確認是否漏音。");
          bars.push(events.map(rhythmTex).join(" ") || "r.1");
          const thumb = document.createElement("canvas");
          const top = Math.max(0, staff.lines[0] - staff.gap * 3);
          const height = Math.min(canvas.height - top, staff.gap * 11);
          thumb.width = Math.ceil(right - left);
          thumb.height = Math.ceil(height);
          thumb
            .getContext("2d")!
            .drawImage(canvas, left, top, right - left, height, 0, 0, thumb.width, thumb.height);
          measures.push({
            bounds: {
              x: left / canvas.width,
              y: top / canvas.height,
              width: (right - left) / canvas.width,
              height: height / canvas.height,
            },
            page,
            boundaryFrom,
            image: thumb.toDataURL("image/png"),
            notes: notes.length,
            messages: [...new Set(messages)],
          });
        }
        outgoing =
          previous && !missed.some((x) => x >= previous!.x)
            ? {
                page,
                bar: bars.length - 1,
                notes: previous.notes.map((n) => ({
                  string: n.string,
                  fret: n.fret,
                  directions: boundaryTieDirections(p, staff, previous!.x, n.string, "out"),
                })),
              }
            : undefined;
      }
    }
    if (!recognizedEvents)
      throw Error("找到六線譜，但沒有可靠讀取到品格數字或休止符；請提高解析度或手動輸入。");
    const score = importer.ScoreLoader.loadAlphaTex(
      `\\tempo 80 \\instrument 25 . \\ts 4 4 ${bars.join(" | ")}`,
    );
    score.title = source.title;
    const json = changeScore(model.JsonConverter.scoreToJson(score), (s) => {
      for (const [i, mark] of repeats.entries()) {
        s.masterBars[i].isRepeatStart = mark.start;
        s.masterBars[i].repeatCount = mark.count;
        s.masterBars[i].alternateEndings = mark.ending;
      }
      for (const tie of ties) {
        const note = s.tracks[0].staves[0].bars[tie.bar].voices[0].beats[tie.beat]?.notes.find(
          (n) => n.string === tie.string,
        );
        if (note) note.isTieDestination = true;
      }
    });
    return {
      ...source,
      kind: "score",
      reference: undefined,
      original: original.file,
      scoreJson: json,
      measures: bars.length,
      bpm: 80,
      tuning: "E A D G B E",
      capo: 0,
      suggestedFingering: false,
      practice: { ...defaultPractice(), notation: "tab" },
      warnings: [
        "六線譜弦品為圖片辨識候選，非系統安排指法。拍號 4/4、80 BPM、標準調弦及無 Capo 為待確認設定。休止符、附點與有括號的 3／5／6 連音為保守辨識候選，必須校對。全／二分休止符依支撐線位置辨識；延音線限相鄰同弦同音；跨譜列／連續頁須兩端同向半弧線才產生候選，仍須對照兩端校對。缺少任一端、跳頁、無括號連音及技巧記號需手動校對。反覆雙線圓點與有括線的 1／2 房為候選，總遍數與房號範圍必須校對。跨反覆跳轉或房號邊界的延音不自動連接，請核對重新撥弦。",
      ],
      recognition: {
        engine: "六線譜幾何分析 + Tesseract.js 6.0.1",
        source: original,
        rawScoreJson: json,
        pages: spec,
        reviewed: [],
        shortBars: [],
        status: "draft",
        warnings: [],
        tab: { measures, rhythmReviewed: [], setupConfirmed: false },
      },
    };
  } finally {
    signal.removeEventListener("abort", stop);
    if (worker && !terminated) await worker.terminate();
    else if (worker && terminated) await worker.terminate().catch(() => {});
  }
}
