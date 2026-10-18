import { AlphaTabApi, synth } from "@coderline/alphatab";
import type { AudioPair, PracticeSettings, Snapshot, TimelineBar } from "./model";
import { initialSnapshot } from "./model";
import { barAtTick, boundaryTicks, buildTimeline, interpolate, loopTicks, PPQ } from "./timeline";
/** Synth: alphaSynth's audio output clock. Recording: HTMLAudioElement.currentTime.
 * The animation frame reads the media clock; it never advances musical time itself. */
export class PracticeAudio {
  state: Snapshot = { ...initialSnapshot };
  bars: TimelineBar[] = [];
  settings: PracticeSettings;
  audio: HTMLAudioElement | null = null;
  pair?: AudioPair;
  private raf = 0;
  private objectUrl?: string;
  private disposed = false;
  private beganAt = 0;
  private pausePending = false;
  private pendingSeek: { unit: "tick" | "time"; value: number } | undefined;
  private applied?: PracticeSettings;
  private unsub: (() => void)[] = [];
  constructor(
    public api: AlphaTabApi,
    settings: PracticeSettings,
    private onChange: (s: Snapshot) => void,
    private onTimeline: (b: TimelineBar[]) => void,
    private onError: (s: string) => void,
  ) {
    this.settings = settings;
    const position = (e: synth.PositionChangedEventArgs) => {
      if (this.state.mode !== "synth") return;
      const b = barAtTick(this.bars, e.currentTick);
      this.state = {
        ...this.state,
        tick: e.currentTick,
        endTick: e.endTick,
        time: Math.max(0, e.currentTime),
        duration: e.endTime,
        bar: b?.index ?? 0,
        beat: b ? Math.floor((e.currentTick - b.startTick) / ((PPQ * 4) / b.denominator)) + 1 : 1,
        tempo: e.modifiedTempo || (b?.tempo ?? 80) * this.settings.speed,
        counting: this.state.counting && e.currentTick <= this.beganAt,
      };
      this.emit();
    };
    const loaded = () => {
      this.bars = this.api.tickCache ? buildTimeline(this.api.tickCache) : [];
      this.onTimeline(this.bars);
      this.api.score?.tracks.forEach((t, i) => this.api.changeTrackMute([t], i !== 0));
      this.state.endTick = this.bars.at(-1)?.endTick ?? 0;
      this.state.duration = (this.bars.at(-1)?.endMs ?? 0) / settings.speed;
      this.applied = undefined;
      this.applySettings(this.settings);
      this.api.tickPosition = Math.min(settings.tick, this.state.endTick - 1);
      this.state.ready = this.state.mode === "audio" || this.api.isReadyForPlayback;
      if (this.state.mode === "audio") this.seekTick(settings.tick);
      this.emit();
    };
    const ready = () => {
      this.state.ready = true;
      this.emit();
    };
    const state = (e: synth.PlayerStateChangedEventArgs) => {
      if (e.state !== synth.PlayerState.Playing) {
        // alphaTab snaps to its current beat when it acknowledges pause.
        // Apply a newer seek after all pause listeners, so that snap cannot undo it.
        queueMicrotask(() => {
          this.pausePending = false;
          const seek = this.pendingSeek;
          this.pendingSeek = undefined;
          if (!seek || this.disposed || this.state.mode !== "synth") return;
          if (seek.unit === "tick") this.seekTick(seek.value);
          else this.seekTime(seek.value);
        });
      }
      if (this.state.mode === "synth") {
        this.state.playing = e.state === synth.PlayerState.Playing;
        if (!this.state.playing) this.state.counting = false;
        this.emit();
      }
    };
    const failed = (e: Error) => {
      this.state.ready = false;
      this.pause();
      this.onError(`樂譜或音色載入失敗：${e.message || "請重新載入後再試。"}`);
    };
    api.playerPositionChanged.on(position);
    api.midiLoaded.on(loaded);
    api.playerReady.on(ready);
    api.playerStateChanged.on(state);
    api.error.on(failed);
    this.unsub.push(() => {
      api.playerPositionChanged.off(position);
      api.midiLoaded.off(loaded);
      api.playerReady.off(ready);
      api.playerStateChanged.off(state);
      api.error.off(failed);
    });
    const visibility = () => {
      if (document.hidden && this.state.playing) {
        this.pause();
        this.onError("離開頁面時已暫停。回來後按「播放」即可從目前位置繼續。");
      }
    };
    document.addEventListener("visibilitychange", visibility);
    const interruption = () => {
      if (this.state.playing) {
        this.pause();
        this.onError("音訊可能被其他應用程式中斷，已同步暫停。請按播放繼續。");
      }
    };
    window.addEventListener("blur", interruption);
    this.unsub.push(() => window.removeEventListener("blur", interruption));
    this.unsub.push(() => document.removeEventListener("visibilitychange", visibility));
  }
  private emit() {
    if (!this.disposed) this.onChange({ ...this.state });
  }
  applySettings(settings: PracticeSettings) {
    const previous = this.applied;
    this.settings = settings;
    if (previous?.speed !== settings.speed) this.api.playbackSpeed = settings.speed;
    if (previous?.volume !== settings.volume) this.api.masterVolume = settings.volume;
    if (previous?.metronome !== settings.metronome)
      this.api.metronomeVolume = settings.metronome ? 0.65 : 0;
    if (previous?.countIn !== settings.countIn)
      this.api.countInVolume = settings.countIn ? 0.65 : 0;
    if (previous?.loop.enabled !== settings.loop.enabled)
      this.api.isLooping = settings.loop.enabled;
    if (
      this.bars.length &&
      (!previous || JSON.stringify(previous.loop) !== JSON.stringify(settings.loop))
    ) {
      const { start, end, enabled } = settings.loop;
      this.api.playbackRange = enabled
        ? loopTicks(this.bars, Math.max(1, start), Math.min(this.api.score!.masterBars.length, end))
        : null;
    }
    this.applied = { ...settings, loop: { ...settings.loop } };
    if (this.audio) {
      this.audio.volume = settings.volume;
      this.audio.playbackRate = this.preservesPitch ? settings.speed : 1;
    }
  }
  get preservesPitch() {
    return !this.audio || "preservesPitch" in this.audio;
  }
  setPair(pair?: AudioPair) {
    this.pause();
    this.releaseAudio();
    this.pair = pair;
    if (pair) {
      this.objectUrl = URL.createObjectURL(pair.file);
      this.audio = new Audio(this.objectUrl);
      this.audio.preload = "auto";
      this.audio.addEventListener("loadedmetadata", () => {
        if (this.state.mode === "audio") this.seekTick(this.state.tick);
      });
      if ("preservesPitch" in this.audio) this.audio.preservesPitch = true;
      this.audio.volume = this.settings.volume;
      this.audio.addEventListener("error", () => {
        this.pause();
        this.onError("音檔無法解碼。請改用此瀏覽器可播放的 MP3、WAV 或 M4A。");
      });
      this.audio.addEventListener("ended", () => {
        this.pause();
        // At the file's exact end, the media ended event can arrive before
        // the next animation frame. Resume the confirmed loop explicitly.
        if (this.state.mode === "audio" && this.settings.loop.enabled) {
          this.seekTick(
            loopTicks(this.bars, this.settings.loop.start, this.settings.loop.end).startTick,
          );
          void this.play();
        }
      });
      this.audio.addEventListener("pause", () => {
        if (this.state.mode === "audio") {
          this.state.playing = false;
          this.emit();
        }
      });
    }
  }
  setMode(mode: "synth" | "audio") {
    this.pause();
    if (mode === "audio" && (!this.audio || !this.pair?.confirmed)) return;
    this.pendingSeek = undefined;
    this.state.mode = mode;
    this.state.ready = mode === "audio" || this.api.isReadyForPlayback;
    this.seekTick(this.state.tick);
    this.emit();
  }
  toggle() {
    if (this.state.playing) this.pause();
    else void this.play();
  }
  async play() {
    if (!this.state.ready) return;
    if (this.settings.loop.enabled && this.bars.length) {
      const range = loopTicks(this.bars, this.settings.loop.start, this.settings.loop.end);
      if (this.state.tick < range.startTick || this.state.tick >= range.endTick)
        this.seekTick(range.startTick);
    } else if (this.state.tick >= this.state.endTick - 1) this.seekTick(0);
    if (this.state.mode === "synth") {
      this.beganAt = this.state.tick;
      this.state.counting = this.settings.countIn;
      if (!this.api.play()) {
        this.state.counting = false;
        this.onError("音訊尚未準備完成，請稍候再按播放；若無聲，請檢查裝置音量。");
      }
    } else if (this.audio) {
      try {
        this.audio.playbackRate = this.preservesPitch ? this.settings.speed : 1;
        await this.audio.play();
        this.state.playing = true;
        this.frame();
      } catch {
        this.onError("瀏覽器未允許播放，或音檔無法解碼。請再次按播放，或換一個音檔。");
      }
    }
    this.emit();
  }
  pause() {
    this.pausePending ||= this.state.mode === "synth" && this.state.playing;
    this.api.pause();
    this.audio?.pause();
    cancelAnimationFrame(this.raf);
    this.state.playing = false;
    this.state.counting = false;
    this.emit();
  }
  seekTick(tick: number) {
    if (this.pausePending && this.state.mode === "synth") {
      this.pendingSeek = { unit: "tick", value: tick };
      return;
    }
    tick = Math.max(0, Math.min(tick, Math.max(0, this.state.endTick - 1)));
    if (this.state.mode === "audio" && this.audio && this.pair) {
      this.audio.currentTime = interpolate(tick, boundaryTicks(this.bars), this.pair.anchors);
      this.syncMedia();
    } else this.api.tickPosition = tick;
  }
  seekTime(ms: number) {
    if (this.pausePending && this.state.mode === "synth") {
      this.pendingSeek = { unit: "time", value: ms };
      return;
    }
    if (this.state.mode === "audio" && this.audio) {
      this.audio.currentTime = Math.max(0, Math.min(ms / 1000, this.pair!.duration));
      this.syncMedia();
    } else this.api.timePosition = ms;
  }
  seekBar(index: number) {
    const b = this.bars.find((b) => b.index === index);
    if (b) this.seekTick(b.startTick);
  }
  private frame = () => {
    if (!this.state.playing || !this.audio) return;
    this.syncMedia();
    this.raf = requestAnimationFrame(this.frame);
  };
  private syncMedia() {
    if (!this.audio || !this.pair) return;
    const ticks = boundaryTicks(this.bars);
    let tick = interpolate(this.audio.currentTime, this.pair.anchors, ticks);
    if (this.state.playing && this.settings.loop.enabled) {
      const loop = loopTicks(this.bars, this.settings.loop.start, this.settings.loop.end);
      if (tick >= loop.endTick) {
        this.audio.currentTime = interpolate(loop.startTick, ticks, this.pair.anchors);
        tick = loop.startTick;
      }
    }
    // alphaSynth is paused in this mode; seeking only updates score cursors.
    this.api.tickPosition = tick;
    const b = barAtTick(this.bars, tick);
    this.state = {
      ...this.state,
      tick,
      time: this.audio.currentTime * 1000,
      duration: this.pair.duration * 1000,
      bar: b?.index ?? 0,
      beat: b ? Math.floor((tick - b.startTick) / ((PPQ * 4) / b.denominator)) + 1 : 1,
      tempo: (b?.tempo ?? 80) * this.settings.speed,
    };
    if (
      this.audio.currentTime >= this.pair.anchors.at(-1)! &&
      this.state.playing &&
      !this.settings.loop.enabled
    )
      this.pause();
    this.emit();
  }
  private releaseAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
  dispose() {
    this.disposed = true;
    this.unsub.forEach((fn) => fn());
    this.pause();
    this.releaseAudio();
  }
}
