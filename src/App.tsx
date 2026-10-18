import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  FileMusic,
  Focus,
  Headphones,
  HelpCircle,
  Library,
  Menu,
  Minus,
  Music2,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { model } from "@coderline/alphatab";
import { library } from "./storage/library";
import { createDemo } from "./music/demo";
import {
  defaultPractice,
  initialSnapshot,
  type Piece,
  type PracticeSettings,
  type Snapshot,
  type TimelineBar,
} from "./music/model";
import type { PracticeAudio } from "./music/audio";
import { ScoreView } from "./components/ScoreView";
import { Transport } from "./components/Transport";
import { ImportDialog } from "./components/ImportDialog";
import { ChordDiagram, ChordDialog } from "./components/ChordDialog";
import { recognizedReference } from "./music/alignment-score";
import { AudioDialog } from "./components/AudioDialog";
import { LoopDialog } from "./components/LoopDialog";
import { ReferenceViewer } from "./components/ReferenceViewer";
import { Dialog } from "./components/Dialog";
import { chordShapes } from "./music/accompaniment";
function Logo() {
  return (
    <span className="brand-icon" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <g stroke="currentColor" strokeWidth="1.1">
          {[10, 14, 18, 22, 26, 30].map((x) => (
            <path key={x} d={`M${x} 9v22`} />
          ))}
          <path d="M8 26 Q20 10 32 17" strokeWidth="2.6" fill="none" />
        </g>
      </svg>
    </span>
  );
}
function Thumbnail({ piece }: { piece: Piece }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!piece.reference?.mime.startsWith("image/")) return;
    const url = URL.createObjectURL(piece.reference.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [piece.reference?.file]);
  const notes = useMemo(() => {
    if (!piece.scoreJson) return [];
    try {
      const score = model.JsonConverter.jsonToScore(piece.scoreJson);
      return (
        score.tracks[0]?.staves[0]?.bars[0]?.voices[0]?.beats.slice(0, 5).flatMap((beat, index) =>
          beat.notes
            .filter((note) => note.isStringed)
            .map((note) => ({
              x: 25 + index * 25,
              y: 12 + (6 - note.string) * 8,
              fret: note.fret,
            })),
        ) ?? []
      );
    } catch {
      return [];
    }
  }, [piece.scoreJson]);
  return (
    <div className={`piece-thumbnail ${piece.kind}`} aria-hidden="true">
      <span>{piece.kind === "reference" ? "原譜" : piece.kind === "chords" ? "CHORD" : "TAB"}</span>
      {preview ? (
        <img src={preview} alt="" />
      ) : piece.kind === "reference" ? (
        <FileMusic size={46} />
      ) : (
        <svg viewBox="0 0 150 65">
          {[12, 20, 28, 36, 44, 52].map((y) => (
            <line key={y} x1="8" x2="142" y1={y} y2={y} stroke="currentColor" opacity=".25" />
          ))}
          {notes.map((note, index) => (
            <g key={index}>
              <rect x={note.x - 4} y={note.y - 5} width="10" height="10" fill="#f2f3e9" />
              <text x={note.x} y={note.y + 4} textAnchor="middle" fontSize="10" fill="currentColor">
                {note.fret}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
export default function App() {
  const [pieces, setPieces] = useState<Piece[]>([]),
    [activeId, setActiveId] = useState(""),
    [loading, setLoading] = useState(true),
    [view, setView] = useState<"practice" | "library">("practice"),
    [sidebar, setSidebar] = useState(true),
    [mobileMenu, setMobileMenu] = useState(false),
    [focus, setFocus] = useState(false);
  const [settings, setSettings] = useState<PracticeSettings>(defaultPractice),
    [state, setState] = useState<Snapshot>(initialSnapshot),
    [bars, setBars] = useState<TimelineBar[]>([]),
    [engine, setEngine] = useState<PracticeAudio | null>(null),
    [track, setTrack] = useState(0),
    [browsing, setBrowsing] = useState(false),
    [jump, setJump] = useState(0),
    [diagrams, setDiagrams] = useState(false);
  const [dialog, setDialog] = useState<
      "import" | "chords" | "audio" | "loop" | "help" | "edit" | "sound" | null
    >(null),
    [manage, setManage] = useState<{ piece: Piece; action: "rename" | "delete" } | null>(null),
    [rename, setRename] = useState(""),
    [query, setQuery] = useState(""),
    [removing, setRemoving] = useState(false),
    [notice, setNotice] = useState(""),
    [storageError, setStorageError] = useState("");
  const active = pieces.find((p) => p.id === activeId);
  const deletedIds = useRef(new Set<string>());
  const currentRef = useRef({ active, settings, state });
  currentRef.current = { active, settings, state };
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const save = useCallback(async (p: Piece) => {
    if (deletedIds.current.has(p.id)) return;
    try {
      await library.save(p);
      setStorageError("");
    } catch {
      setStorageError(
        "無法儲存到這個瀏覽器；本次仍可練習，但重新整理會遺失變更。請檢查儲存空間或私密瀏覽設定。",
      );
    }
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      let all: Piece[] = [];
      let last: string | undefined;
      try {
        all = await library.all();
        if (!(await library.getMeta("initialized"))) {
          const demo = createDemo();
          await library.save(demo);
          await library.setMeta("initialized", "yes");
          all = [demo, ...all];
        }
        last = await library.getMeta("active");
      } catch {
        all = [createDemo()];
        setStorageError("無法開啟本機資料庫，目前以暫存模式練習。關閉頁面後可能遺失資料。");
      }
      if (live) {
        setPieces(all);
        const p = all.find((p) => p.id === last) ?? all[0];
        if (p) {
          setActiveId(p.id);
          setSettings(p.practice);
        } else setView("library");
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const persistCurrent = useCallback(() => {
    const c = currentRef.current;
    if (!c.active || deletedIds.current.has(c.active.id)) return;
    const p = {
      ...c.active,
      practice: { ...c.settings, tick: c.state.tick },
      updatedAt: Date.now(),
    };
    setPieces((items) => items.map((x) => (x.id === p.id ? p : x)));
    void save(p);
  }, [save]);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(persistCurrent, 800);
    return () => clearTimeout(id);
  }, [settings, activeId, persistCurrent]);
  useEffect(() => {
    if (!state.playing && state.ready) persistCurrent();
  }, [state.playing, state.ready, persistCurrent]);
  useEffect(() => {
    const fn = () => persistCurrent();
    window.addEventListener("pagehide", fn);
    document.addEventListener("visibilitychange", fn);
    return () => {
      window.removeEventListener("pagehide", fn);
      document.removeEventListener("visibilitychange", fn);
    };
  }, [persistCurrent]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !document.querySelector("dialog[open]") &&
        !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        engineRef.current?.toggle();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  useEffect(() => {
    if (engine) {
      engine.setPair(active?.audio);
      if (active?.audio?.confirmed) engine.setMode("audio");
    }
  }, [engine, active?.audio]);
  const select = (p: Piece) => {
    engine?.pause();
    persistCurrent();
    setActiveId(p.id);
    setSettings(p.practice);
    setState({ ...initialSnapshot });
    setBars([]);
    setTrack(0);
    setBrowsing(false);
    setView("practice");
    setMobileMenu(false);
    void library.setMeta("active", p.id).catch(() => {});
    window.scrollTo({ top: 0 });
  };
  const imported = async (p: Piece) => {
    deletedIds.current.delete(p.id);
    engine?.pause();
    await save(p);
    await library.setMeta("active", p.id).catch(() => {});
    setPieces((items) => [p, ...items.filter((x) => x.id !== p.id)]);
    setActiveId(p.id);
    setSettings(p.practice);
    setState({ ...initialSnapshot });
    setBars([]);
    setTrack(0);
    setView("practice");
    setDialog(null);
    setBrowsing(false);
    setMobileMenu(false);
    void library.setMeta("active", p.id).catch(() => {});
    window.scrollTo({ top: 0 });
  };
  const changeSettings = (patch: Partial<PracticeSettings>) => {
    setSettings((old) => ({ ...old, ...patch }));
  };
  const openDialog = (type: typeof dialog) => {
    if (type === "import" || type === "edit" || type === "audio" || type === "chords")
      engine?.pause();
    setDialog(type);
  };
  const onEngine = useCallback((e: PracticeAudio | null) => {
    setEngine(e);
    if (import.meta.env.DEV)
      (window as unknown as { __practice: PracticeAudio | null }).__practice = e;
  }, []);
  const onState = useCallback((s: Snapshot) => setState(s), []);
  const onTimeline = useCallback((b: TimelineBar[]) => setBars(b), []);
  const onError = useCallback((s: string) => setNotice(s), []);
  const onBrowse = useCallback(() => setBrowsing(true), []);
  const visible = pieces.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));
  const playable =
    !!active &&
    (!active.recognition || active.recognition.status === "confirmed") &&
    (active.kind !== "reference" || (!!active.reference?.confirmed && active.measures > 0));
  const score = useMemo(() => {
    try {
      return active?.scoreJson ? model.JsonConverter.jsonToScore(active.scoreJson) : null;
    } catch {
      return null;
    }
  }, [active?.scoreJson]);
  const recordedReference = useMemo(
    () => recognizedReference(active),
    [active?.scoreJson, active?.recognition],
  );
  const [showOriginalRecording, setShowOriginalRecording] = useState(true);
  const originalRecording =
    state.mode === "audio" && showOriginalRecording ? recordedReference : undefined;
  const chords = Array.from(
    new Set(
      score?.tracks.flatMap((t) =>
        t.staves.flatMap((s) => (s.chords ? [...s.chords.values()].map((c) => c.name) : [])),
      ) ?? [],
    ),
  );
  return (
    <div className={`app ${sidebar ? "" : "sidebar-collapsed"} ${focus ? "focus-mode" : ""}`}>
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("practice");
          }}
        >
          <Logo />
          <span>
            弦間<span className="brand-en">STRING SPACE</span>
          </span>
        </a>
        <div className="header-separator" />
        <span className="header-caption">留一點時間，給喜歡的聲音。</span>
        <div className="header-actions">
          <span className="local-label">
            <span className="status-dot" />
            {storageError ? "儲存受限" : "儲存在此裝置"}
          </span>
          <button className="icon-button" aria-label="使用說明" onClick={() => openDialog("help")}>
            <HelpCircle size={19} />
          </button>
          <button
            className="mobile-menu icon-button"
            aria-label="開啟我的樂譜"
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu size={21} />
          </button>
        </div>
      </header>
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <div className="sidebar-top">
          <span className="eyebrow">你的練習空間</span>
          <button
            className="icon-button collapse-sidebar"
            title="收合曲目清單"
            aria-label="收合曲目清單"
            onClick={() => setSidebar(false)}
          >
            <PanelLeftClose size={17} />
          </button>
          <button
            className="mobile-menu icon-button"
            aria-label="關閉曲目清單"
            onClick={() => setMobileMenu(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button
          className={`nav-item ${view === "library" ? "active" : ""}`}
          onClick={() => {
            engine?.pause();
            setView("library");
            setMobileMenu(false);
          }}
        >
          <Library size={19} />
          我的樂譜<span>{pieces.length}</span>
        </button>
        <button className="sidebar-upload" onClick={() => openDialog("import")}>
          <Plus size={18} />
          上傳樂譜
        </button>
        <div className="sidebar-section-label">練習中的曲目</div>
        <div className="sidebar-pieces">
          {pieces.map((p) => (
            <button
              key={p.id}
              className={`sidebar-piece ${activeId === p.id && view === "practice" ? "active" : ""}`}
              onClick={() => select(p)}
            >
              <span className="spine-icon">
                <FileMusic size={19} />
              </span>
              <span>
                <strong>{p.title}</strong>
                <small>
                  {p.kind === "reference"
                    ? "圖片／PDF 原譜"
                    : p.demo
                      ? "原創示範曲"
                      : p.kind === "chords"
                        ? "練習伴奏"
                        : "數位樂譜"}{" "}
                  · {p.measures} 小節
                </small>
              </span>
              {activeId === p.id && <span className="tiny-dot" />}
            </button>
          ))}
        </div>
        <button className="new-chords" onClick={() => openDialog("chords")}>
          <Music2 size={17} />
          <span>建立和弦伴奏</span>
          <Plus size={15} />
        </button>
        <div className="sidebar-bottom">
          <div className="small-string-art" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <i key={i} />
            ))}
          </div>
          <p>
            不用一次彈好整首。
            <br />
            今天，練好這一小段。
          </p>
          <span>MADE FOR YOUR DAILY PRACTICE</span>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="sidebar-scrim"
          aria-label="關閉選單"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <main className="main-content" id="main-content">
        {storageError && (
          <div className="error persistent" role="alert">
            {storageError}
          </div>
        )}
        {notice && (
          <div className="notice dismissible" role="status">
            <span>{notice}</span>
            <button className="icon-button" aria-label="關閉訊息" onClick={() => setNotice("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {loading ? (
          <div className="empty-state" role="status">
            <Logo />
            <h2>正在打開練習室…</h2>
          </div>
        ) : view === "library" ? (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR SHEET MUSIC</span>
                <h1>我的樂譜</h1>
                <p>收藏喜歡的旋律，從上次停下的地方繼續。</p>
              </div>
              <button className="primary" onClick={() => openDialog("import")}>
                <Upload size={17} />
                上傳樂譜
              </button>
            </div>
            <div className="library-tools">
              <label className="search">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜尋曲目名稱"
                  aria-label="搜尋曲目"
                />
              </label>
              <span>{visible.length} 首樂譜</span>
            </div>
            <div className="library-grid">
              {visible.map((p) => (
                <article className="library-piece" key={p.id}>
                  <button className="piece-open" onClick={() => select(p)}>
                    <Thumbnail piece={p} />
                    <div>
                      <span className="eyebrow">
                        {p.demo
                          ? "原創示範"
                          : p.kind === "reference"
                            ? "原始譜面"
                            : p.kind === "chords"
                              ? "練習伴奏"
                              : p.recognition
                                ? p.recognition.status === "draft"
                                  ? "辨識校對草稿"
                                  : "已校對數位譜"
                                : "MUSICXML"}
                      </span>
                      <h3>{p.title}</h3>
                      <p>
                        {p.measures} 小節 <span>·</span> {p.bpm} BPM
                      </p>
                      <small>
                        {p.practice.tick > 0 ? "繼續上次的練習" : "準備開始第一遍練習"}{" "}
                        <ArrowRight size={14} />
                      </small>
                    </div>
                  </button>
                  <div className="piece-actions">
                    <span>
                      {p.kind === "reference" && !p.reference?.confirmed
                        ? "尚待標記小節"
                        : "可以開始練習"}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`重新命名 ${p.title}`}
                      onClick={() => {
                        setManage({ piece: p, action: "rename" });
                        setRename(p.title);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`刪除 ${p.title}`}
                      onClick={() => setManage({ piece: p, action: "delete" })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!visible.length && (
              <div className="empty-state">
                <BookOpen size={38} />
                <h2>{query ? "沒有符合的曲目" : "第一首練習，從這裡開始"}</h2>
                <p>{query ? "換個關鍵字試試看。" : "上傳樂譜，或載入原創示範曲。"}</p>
                {!query && (
                  <div className="inline">
                    <button className="primary" onClick={() => openDialog("import")}>
                      上傳樂譜
                    </button>
                    <button onClick={() => imported(createDemo())}>載入示範曲</button>
                  </div>
                )}
              </div>
            )}
          </>
        ) : active ? (
          <>
            <div className="practice-breadcrumb">
              <button
                className="icon-button expand-sidebar"
                aria-label="展開曲目清單"
                onClick={() => setSidebar(true)}
              >
                <Menu size={18} />
              </button>
              <button
                onClick={() => {
                  engine?.pause();
                  setView("library");
                }}
              >
                我的樂譜
              </button>
              <ChevronRight size={13} />
              <span>練習室</span>
              <span className="saved">
                <Check size={13} />
                {storageError ? "暫存於本次頁面" : "自動保存練習進度"}
              </span>
            </div>
            <div className="practice-heading">
              <div>
                <div className="eyebrow">
                  <span className="title-line" />
                  {active.demo
                    ? "原創入門練習曲"
                    : active.kind === "reference"
                      ? "原譜閱讀與練習"
                      : active.kind === "chords"
                        ? "和弦練習伴奏"
                        : "你的數位樂譜"}
                </div>
                <h1>{active.title}</h1>
                <p>{active.demo ? "放慢一點，讓每一個音都清楚。" : active.sourceName}</p>
              </div>
              <button className="focus-button" onClick={() => setFocus(!focus)}>
                <Focus size={17} />
                {focus ? "退出專注" : "專注練習"}
              </button>
            </div>
            <div className="score-meta">
              <span>
                <Music2 size={15} />
                <strong>{active.bpm}</strong> BPM
              </span>
              <span>
                {score
                  ? `${score.masterBars[0].timeSignatureNumerator}/${score.masterBars[0].timeSignatureDenominator}`
                  : `${active.reference?.numerator}/${active.reference?.denominator}`}{" "}
                拍
              </span>
              <span>{active.measures} 小節</span>
              <i />
              <span className="tuning">
                調弦 <strong>{active.tuning}</strong>
              </span>
              <span>
                Capo <strong>{active.capo || "無"}</strong>
              </span>
              <span className="level-tag">
                {active.suggestedFingering
                  ? "系統建議指法"
                  : active.demo
                    ? "初學友善"
                    : active.kind === "reference"
                      ? "手動同步"
                      : active.recognition?.tab
                        ? "已校對的弦品"
                        : "原譜指法"}
              </span>
            </div>
            <div className="practice-toolbar">
              <div className="mode-picker">
                <label>
                  <Headphones size={16} />
                  <select
                    aria-label="播放模式"
                    value={state.mode}
                    onChange={(e) => {
                      if (e.target.value === "audio" && !engine?.preservesPitch) {
                        changeSettings({ speed: 1 });
                        setNotice("此瀏覽器不支援錄音保音高變速，錄音將以 1× 播放。");
                      }
                      engine?.setMode(e.target.value as "synth" | "audio");
                    }}
                  >
                    <option value="synth">
                      {active.kind === "reference"
                        ? "原譜＋節拍引導"
                        : active.kind === "chords"
                          ? "和弦練習伴奏"
                          : "依樂譜合成播放"}
                    </option>
                    {active.audio?.confirmed && <option value="audio">使用我的音檔</option>}
                  </select>
                  <ChevronDown size={13} />
                </label>
                <button
                  className="icon-button"
                  title="配對音檔與校正小節時間"
                  aria-label="配對音檔"
                  disabled={!playable || !bars.length}
                  onClick={() => openDialog("audio")}
                >
                  <Plus size={17} />
                </button>
              </div>
              <div className="view-tools">
                <button
                  className={`text-button ${settings.follow && !browsing ? "active" : ""}`}
                  aria-pressed={settings.follow}
                  onClick={() => {
                    changeSettings({ follow: !settings.follow });
                    setBrowsing(false);
                  }}
                >
                  <Target size={16} />
                  <span>自動跟隨</span>
                </button>
                {active.kind !== "reference" && (
                  <>
                    <span className="tool-divider" />
                    <select
                      aria-label="樂譜顯示方式"
                      value={settings.notation}
                      onChange={(e) =>
                        changeSettings({ notation: e.target.value as PracticeSettings["notation"] })
                      }
                    >
                      <option value="tab">六線譜</option>
                      <option value="score">五線譜</option>
                      <option value="both">雙譜</option>
                    </select>
                    <div className="zoom">
                      <button
                        className="icon-button"
                        aria-label="縮小樂譜"
                        disabled={settings.zoom <= 0.8}
                        onClick={() => changeSettings({ zoom: Math.max(0.8, settings.zoom - 0.1) })}
                      >
                        <Minus size={15} />
                      </button>
                      <button title="適合螢幕寬度" onClick={() => changeSettings({ zoom: 1 })}>
                        {Math.round(settings.zoom * 100)}%
                      </button>
                      <button
                        className="icon-button"
                        aria-label="放大樂譜"
                        disabled={settings.zoom >= 1.5}
                        onClick={() => changeSettings({ zoom: Math.min(1.5, settings.zoom + 0.1) })}
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {browsing && settings.follow && (
              <button
                className="return-to-play"
                onClick={() => {
                  setBrowsing(false);
                  setJump((j) => j + 1);
                }}
              >
                <Target size={16} />
                回到目前播放位置
              </button>
            )}
            {active.warnings.length > 0 && (
              <details className="score-notes">
                <summary>
                  <SlidersHorizontal size={15} />
                  {active.kind === "reference"
                    ? "尚無音符辨識 · 查看可用的練習方式"
                    : active.suggestedFingering
                      ? "含系統建議指法 · 查看匯入與校對資訊"
                      : "查看匯入與校對資訊"}
                </summary>
                {active.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                {active.original && (
                  <button
                    onClick={() => {
                      const u = URL.createObjectURL(active.original!);
                      const a = document.createElement("a");
                      a.href = u;
                      a.download = active.sourceName;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(u), 1000);
                    }}
                  >
                    下載原始檔案
                  </button>
                )}
              </details>
            )}
            {score && score.tracks.length > 1 && (
              <label className="track-select">
                練習聲部
                <select
                  value={track}
                  onChange={(e) => {
                    engine?.pause();
                    setTrack(+e.target.value);
                  }}
                >
                  {score.tracks.map((t, i) => (
                    <option value={i} key={i}>
                      {t.name || `聲部 ${i + 1}`}
                    </option>
                  ))}
                </select>
                <small>只播放所選聲部</small>
              </label>
            )}
            <article className="sheet-paper">
              {active.recognition && (
                <div className="reference-actions">
                  <span>
                    {active.recognition.status === "confirmed"
                      ? "辨識結果已人工校對 · 保留原譜可再次修正"
                      : "辨識草稿尚未確認 · 播放暫停用"}
                  </span>
                  <button className="text-button" onClick={() => openDialog("edit")}>
                    校對辨識結果與原譜
                  </button>
                </div>
              )}
              <header className="sheet-header">
                <div>
                  <span className="eyebrow">
                    {active.kind === "reference" ? "ORIGINAL SHEET" : "GUITAR PRACTICE"}
                  </span>
                  <h2>{active.title}</h2>
                  <span>
                    {active.demo ? "弦間原創 · 尼龍弦吉他" : active.composer || active.sourceName}
                  </span>
                </div>
                <div className="sheet-number">
                  {active.kind === "reference" ? "REF" : "TAB"}
                  <small>{active.kind === "reference" ? "原譜" : "六根弦，一小段時光"}</small>
                </div>
              </header>
              {chords.length > 0 && (
                <div className="chord-strip">
                  <button className="text-button" onClick={() => setDiagrams(!diagrams)}>
                    <Music2 size={15} />
                    和弦指法
                    <ChevronDown size={14} />
                  </button>
                  {diagrams ? (
                    chords.map((c) =>
                      chordShapes[c] ? <ChordDiagram key={c} name={c} /> : <span key={c}>{c}</span>,
                    )
                  ) : (
                    <span>{chords.join("  /  ")}</span>
                  )}
                </div>
              )}
              {active.kind === "reference" && active.reference && (
                <>
                  <div className="reference-actions">
                    <span>
                      {active.reference.confirmed
                        ? state.mode === "audio"
                          ? "依音檔校正時間同步原譜 · 小節內游標為時間內插"
                          : "依手動標記的拍數引導，未辨識旋律"
                        : "原譜已保存，標記小節後即可跟拍"}
                    </span>
                    <button className="text-button" onClick={() => openDialog("edit")}>
                      <Pencil size={15} />
                      校對與標記
                    </button>
                  </div>
                  <ReferenceViewer
                    data={active.reference}
                    onBrowse={onBrowse}
                    active={state.bar}
                    jumpSignal={jump}
                    progress={(() => {
                      const b = bars.find(
                        (b) => state.tick >= b.startTick && state.tick < b.endTick,
                      );
                      return b ? (state.tick - b.startTick) / (b.endTick - b.startTick) : 0;
                    })()}
                    follow={settings.follow && !browsing && state.playing}
                    onSeek={(i) => engine?.seekBar(i)}
                  />
                </>
              )}
              {recordedReference && state.mode === "audio" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowOriginalRecording(!showOriginalRecording)}
                >
                  {showOriginalRecording ? "改看校對後數位譜" : "跟隨原始 PDF 譜面"}
                </button>
              )}
              {originalRecording && (
                <ReferenceViewer
                  data={originalRecording}
                  active={state.bar}
                  jumpSignal={jump}
                  onBrowse={onBrowse}
                  follow={settings.follow && !browsing && state.playing}
                  progress={(() => {
                    const b = bars.find((b) => state.tick >= b.startTick && state.tick < b.endTick);
                    return b ? (state.tick - b.startTick) / (b.endTick - b.startTick) : 0;
                  })()}
                  onSeek={(i) => engine?.seekBar(i)}
                />
              )}
              {playable && (
                <ScoreView
                  key={active.id}
                  piece={active}
                  settings={settings}
                  onEngine={onEngine}
                  onState={onState}
                  onTimeline={onTimeline}
                  onError={onError}
                  onBrowse={onBrowse}
                  following={settings.follow && !browsing}
                  track={track}
                  hidden={active.kind === "reference" || !!originalRecording}
                  jumpSignal={jump}
                />
              )}
              {!playable && (
                <div className="reference-next">
                  <button className="primary" onClick={() => openDialog("edit")}>
                    <Pencil size={16} />
                    {active.recognition ? "繼續校對音符與節奏" : "辨識音符或標記小節"}
                  </button>
                  <p>
                    {active.recognition
                      ? "請逐小節確認音符及拍數，完成後即可合成播放。"
                      : "印刷五線譜或六線譜可先辨識，再校對音符、弦品與節奏。"}
                  </p>
                </div>
              )}
              <footer className="sheet-footer">
                <span>
                  {active.kind === "reference"
                    ? "你看到的是上傳的原始譜面"
                    : "點一下小節，即可從那裡開始"}
                </span>
                <span>
                  {active.kind === "reference" ? "此曲尚未辨識音符" : "以音訊播放位置同步"}
                </span>
              </footer>
            </article>
            <div className="practice-tip">
              <span>練習小提示</span>
              <p>
                {active.demo
                  ? "先用 0.75× 播放，熟悉前四個小節。按下 A–B 循環，讓手指有時間記住旋律。"
                  : "先聽一遍，再把需要練習的幾個小節設成循環。清楚，比快更重要。"}
              </p>
              <span className="keyboard-hint">
                <kbd>space</kbd> 播放 / 暫停
              </span>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>選一首樂譜，開始練習</h2>
            <button className="primary" onClick={() => openDialog("import")}>
              上傳樂譜
            </button>
          </div>
        )}
      </main>
      {view === "practice" && active && (
        <Transport
          state={playable ? state : { ...initialSnapshot }}
          settings={settings}
          onSettings={changeSettings}
          engine={playable ? engine : null}
          onLoop={() => openDialog("loop")}
          onSound={() => openDialog("sound")}
          piece={active}
          bars={bars}
        />
      )}
      {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} onImport={imported} />}{" "}
      {dialog === "edit" && active && (
        <ImportDialog
          existing={active}
          onClose={() => setDialog(null)}
          onImport={(p) => imported({ ...p, audio: undefined })}
        />
      )}
      {dialog === "chords" && <ChordDialog onClose={() => setDialog(null)} onCreate={imported} />}
      {dialog === "loop" && active && (
        <LoopDialog
          loop={settings.loop}
          count={active.measures}
          current={state.bar}
          onClose={() => setDialog(null)}
          onSave={(loop) => {
            changeSettings({ loop });
            setDialog(null);
          }}
        />
      )}
      {dialog === "audio" && active && (
        <AudioDialog
          piece={active}
          bars={bars}
          track={track}
          onRecognize={() => setDialog("edit")}
          onClose={() => setDialog(null)}
          onSave={async (audio) => {
            const p = { ...active, audio };
            setPieces((items) => items.map((x) => (x.id === p.id ? p : x)));
            await save(p);
            setDialog(null);
            setNotice("音檔與小節時間已保存，已切換使用你的音檔；按播放即可跟譜。");
          }}
        />
      )}
      {dialog === "sound" && (
        <Dialog title="音量與播放設定" onClose={() => setDialog(null)}>
          <label className="field">
            播放音量 {Math.round(settings.volume * 100)}%
            <input
              aria-label="練習音量"
              type="range"
              min="0"
              max="1"
              step=".01"
              value={settings.volume}
              disabled={state.mode === "audio" && /iPhone|iPad|iPod/.test(navigator.userAgent)}
              onChange={(e) => changeSettings({ volume: +e.target.value })}
            />
          </label>
          {state.mode === "audio" && /iPhone|iPad|iPod/.test(navigator.userAgent) && (
            <p className="hint">此裝置的錄音音量請使用實體音量鍵調整。</p>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={settings.countIn}
              disabled={state.mode === "audio"}
              onChange={(e) => changeSettings({ countIn: e.target.checked })}
            />
            播放前預備一小節
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={settings.metronome}
              disabled={state.mode === "audio"}
              onChange={(e) => changeSettings({ metronome: e.target.checked })}
            />
            播放節拍器
          </label>
          <p className="hint">預備拍與節拍器使用與樂譜相同的音訊引擎。錄音模式不提供這兩項功能。</p>
        </Dialog>
      )}
      {dialog === "help" && (
        <Dialog title="第一次練習，從這裡開始" onClose={() => setDialog(null)}>
          <ol className="help-list">
            <li>
              <strong>先聽，再跟著彈。</strong>
              <p>按播放聽吉他合成音色；預備拍會先倒數一小節。這不是原曲錄音。</p>
            </li>
            <li>
              <strong>慢一點也很好。</strong>
              <p>選擇 0.5× 或 0.75×，音高不變。點擊小節可以跳轉，A–B 循環可以反覆練一段。</p>
            </li>
            <li>
              <strong>把自己的譜帶進來。</strong>
              <p>
                MusicXML 可解析音符。JPG、PNG 和 PDF
                可選五線譜或六線譜辨識，再逐小節校對；六線譜無節奏標記時需人工設定時值。也可只框選小節跟拍。
              </p>
            </li>
            <li>
              <strong>你的音檔，你來對齊。</strong>
              <p>
                按播放模式旁的「＋」，逐小節標記音檔時間。確認後才能使用錄音跟譜；每個小節內依時間內插。
              </p>
            </li>
          </ol>
          <p className="notice">
            手機切換 App
            或鎖定螢幕時會暫停，回來請再按播放。首次播放需手動點擊；錄音變速依瀏覽器的保音高能力提供。
          </p>
          <p className="privacy">
            <ShieldCheck size={16} />
            免登入。資料保存在此瀏覽器，清除網站資料會一併刪除。
          </p>
          <a className="text-link" href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">
            開源工具與音色授權
          </a>
        </Dialog>
      )}
      {manage && (
        <Dialog
          title={manage.action === "rename" ? "重新命名樂譜" : "刪除這首樂譜？"}
          onClose={() => setManage(null)}
        >
          {manage.action === "rename" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!rename.trim()) return;
                const p = { ...manage.piece, title: rename.trim() };
                setPieces((items) => items.map((x) => (x.id === p.id ? p : x)));
                void save(p);
                setManage(null);
              }}
            >
              <label className="field">
                曲目名稱
                <input
                  autoFocus
                  value={rename}
                  maxLength={120}
                  onChange={(e) => setRename(e.target.value)}
                />
              </label>
              <div className="dialog-actions">
                <button className="primary" disabled={!rename.trim()}>
                  保存名稱
                </button>
              </div>
            </form>
          ) : (
            <>
              <p>
                「{manage.piece.title}
                」與這首曲目的本機練習進度、音檔將被刪除。你的原始檔案不受影響。
              </p>
              <div className="dialog-actions">
                <button onClick={() => setManage(null)}>保留樂譜</button>
                <button
                  className="danger"
                  disabled={removing}
                  onClick={async () => {
                    const id = manage.piece.id;
                    deletedIds.current.add(id);
                    setRemoving(true);
                    if (id === activeId) {
                      engine?.pause();
                    }
                    try {
                      await library.remove(id);
                    } catch {
                      setStorageError("刪除未能寫入本機資料庫，重新整理後曲目可能仍存在。");
                    }
                    if (id === activeId) {
                      setActiveId("");
                      setView("library");
                    }
                    setPieces((items) => items.filter((p) => p.id !== id));
                    setRemoving(false);
                    setManage(null);
                  }}
                >
                  {removing ? "正在刪除…" : "刪除樂譜"}
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
