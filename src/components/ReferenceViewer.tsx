import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Crop, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { ReferenceData } from "../music/model";
export function ReferenceViewer({
  data,
  edit = false,
  onChange,
  active = -1,
  follow = false,
  onSeek,
  progress = 0,
  jumpSignal = 0,
  onBrowse,
}: {
  data: ReferenceData;
  edit?: boolean;
  onChange?: (d: ReferenceData) => void;
  active?: number;
  follow?: boolean;
  onSeek?: (i: number) => void;
  progress?: number;
  jumpSignal?: number;
  onBrowse?: () => void;
}) {
  const [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [source, setSource] = useState(""),
    [sourcePage, setSourcePage] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && active >= 0 && data.markers[active]) setPage(data.markers[active].page);
  }, [active, follow, data.markers]);
  const lastJump = useRef(0);
  useEffect(() => {
    const force = lastJump.current !== jumpSignal;
    lastJump.current = jumpSignal;
    if (force && data.markers[active]) setPage(data.markers[active].page);
    if ((follow || force) && !edit) {
      const m = data.markers[active];
      if (!m || m.page !== page || !frame.current) return;
      const r = frame.current.getBoundingClientRect();
      const top = r.top + m.y * r.height;
      const bottom = top + m.height * r.height;
      const dialog = frame.current.closest("dialog");
      const bounds = dialog?.getBoundingClientRect();
      const limit = bounds
        ? bounds.bottom - 24
        : innerHeight -
          (document.querySelector(".transport")?.getBoundingClientRect().height ?? 150) -
          35;
      const edge = bounds ? bounds.top + 24 : 100;
      if (force || top < edge || bottom > limit) {
        const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth";
        if (dialog) dialog.scrollTo({ top: dialog.scrollTop + top - edge, behavior });
        else window.scrollTo({ top: scrollY + top - 120, behavior });
      }
    }
  }, [active, follow, page, source, jumpSignal, edit, data.markers]);
  useEffect(() => {
    let cancelled = false;
    let url = "";
    let cleanup: (() => void) | undefined;
    setLoading(true);
    setError("");
    setSource("");
    void (async () => {
      try {
        if (data.mime === "application/pdf") {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url,
          ).href;
          const task = pdfjs.getDocument({
            data: new Uint8Array(await data.file.arrayBuffer()),
            isEvalSupported: false,
          });
          cleanup = () => {
            void task.destroy();
          };
          const pdf = await task.promise;
          if (cancelled) {
            void pdf.destroy();
            return;
          }
          setPages(pdf.numPages);
          const p = await pdf.getPage(Math.min(page, pdf.numPages));
          const initial = p.getViewport({ scale: 1 });
          const scale = Math.min(2, 1400 / initial.width, 2000 / initial.height);
          const viewport = p.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await p.render({ canvas, viewport }).promise;
          if (!cancelled) {
            setSource(canvas.toDataURL("image/png"));
            setSourcePage(page);
          }
        } else {
          url = URL.createObjectURL(data.file);
          if (!cancelled) {
            setSource(url);
            setSourcePage(page);
          }
        }
      } catch (e) {
        if (!cancelled)
          setError(`原譜預覽失敗：${(e as Error).message}。加密 PDF 請先解除密碼，或改用圖片。`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      cleanup?.();
    };
  }, [data.file, data.mime, page]);
  const point = (e: React.PointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  const commit = () => {
    if (draft && draft.width > 0.025 && draft.height > 0.015)
      onChange?.({
        ...data,
        confirmed: false,
        markers: [...data.markers, { ...draft, id: crypto.randomUUID(), page }],
      });
    origin.current = null;
    setDraft(null);
  };
  const move = (i: number, by: number) => {
    const markers = [...data.markers];
    [markers[i], markers[i + by]] = [markers[i + by], markers[i]];
    onChange?.({ ...data, confirmed: false, markers });
  };
  return (
    <section className="reference-viewer">
      <div className="reference-toolbar">
        <span>
          {edit ? (
            <>
              <Crop size={16} /> 在原譜上拖曳，框出一個小節
            </>
          ) : (
            <>原始譜面</>
          )}
        </span>
        <div className="inline">
          <button
            aria-label="上一頁原譜"
            disabled={page <= 1}
            onClick={() => {
              onBrowse?.();
              setPage(page - 1);
            }}
            className="icon-button"
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            {page} / {pages}
          </span>
          <button
            aria-label="下一頁原譜"
            disabled={page >= pages}
            onClick={() => {
              onBrowse?.();
              setPage(page + 1);
            }}
            className="icon-button"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      {loading && <p role="status">正在載入第 {page} 頁…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {source && sourcePage === page && (
        <div
          className={`reference-image ${edit ? "marking" : ""}`}
          ref={frame}
          onPointerDown={(e) => {
            if (!edit || (e.target as HTMLElement).closest("button")) return;
            origin.current = point(e);
            frame.current!.setPointerCapture(e.pointerId);
            setDraft({ ...origin.current, width: 0, height: 0 });
          }}
          onPointerMove={(e) => {
            if (!origin.current) return;
            const p = point(e);
            setDraft({
              x: Math.min(p.x, origin.current.x),
              y: Math.min(p.y, origin.current.y),
              width: Math.abs(p.x - origin.current.x),
              height: Math.abs(p.y - origin.current.y),
            });
          }}
          onPointerUp={commit}
          onPointerCancel={() => {
            origin.current = null;
            setDraft(null);
          }}
        >
          <img
            src={source}
            alt={`原始樂譜，第 ${page} 頁`}
            draggable={false}
            onError={() => {
              setError("圖片無法讀取，請確認檔案完整，或重新匯出 JPG／PNG 後再試。");
              setSource("");
            }}
          />
          {data.markers.map(
            (m, i) =>
              m.page === page && (
                <button
                  key={m.id}
                  className={`reference-marker ${active === i ? "active" : ""}`}
                  style={{
                    left: `${m.x * 100}%`,
                    top: `${m.y * 100}%`,
                    width: `${m.width * 100}%`,
                    height: `${m.height * 100}%`,
                  }}
                  onClick={() => !edit && onSeek?.(i)}
                  aria-label={`原譜第 ${i + 1} 小節`}
                >
                  <span>{i + 1}</span>
                  {active === i && !edit && (
                    <i
                      className="reference-playhead"
                      style={{ left: `${Math.min(99, Math.max(0, progress * 100))}%` }}
                    />
                  )}
                </button>
              ),
          )}
          {draft && (
            <div
              className="reference-marker drafting"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.width * 100}%`,
                height: `${draft.height * 100}%`,
              }}
            />
          )}
        </div>
      )}
      {edit && (
        <>
          <p className="hint">
            依播放順序框選；反覆段落可重複框選同一區域。手機可用手指拖曳。小節內僅顯示拍點進度，尚無音符辨識。
          </p>
          <div className="marker-list">
            {data.markers.length === 0 ? (
              <p>尚未標記小節。可以先保存原譜，稍後再整理。</p>
            ) : (
              data.markers.map((m, i) => (
                <div key={m.id}>
                  <button onClick={() => setPage(m.page)}>
                    第 {i + 1} 小節 <small>· 頁 {m.page}</small>
                  </button>
                  <button
                    className="icon-button"
                    disabled={i === 0}
                    aria-label={`小節 ${i + 1} 前移`}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={i === data.markers.length - 1}
                    aria-label={`小節 ${i + 1} 後移`}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`刪除標記 ${i + 1}`}
                    onClick={() =>
                      onChange?.({
                        ...data,
                        confirmed: false,
                        markers: data.markers.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
