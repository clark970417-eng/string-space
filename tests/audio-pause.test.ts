import { it, expect } from "vitest";
import type { AlphaTabApi } from "@coderline/alphatab";
import { PracticeAudio } from "../src/music/audio";
import { defaultPractice } from "../src/music/model";

it("a seek immediately after pause wins over the engine pause snap, with the last user seek retained", async () => {
  const event = () => {
    const listeners = new Set<(value: any) => void>();
    return {
      on: (fn: (value: any) => void) => listeners.add(fn),
      off: (fn: (value: any) => void) => listeners.delete(fn),
      emit: (value: any) => listeners.forEach((fn) => fn(value)),
    };
  };
  const state = event();
  const commands: number[] = [];
  const api = {
    playerPositionChanged: event(),
    midiLoaded: event(),
    playerReady: event(),
    playerStateChanged: state,
    error: event(),
    pause: () => {},
    set timePosition(value: number) {
      commands.push(value);
    },
  };
  const engine = new PracticeAudio(
    api as unknown as AlphaTabApi,
    defaultPractice(),
    () => {},
    () => {},
    () => {},
  );
  state.emit({ state: 1 }); // playing
  engine.pause();
  engine.seekTime(2000);
  engine.seekTime(4500);
  expect(commands).toEqual([]);
  // alphaTab's own paused listener snaps the cursor before a newer seek may run.
  state.on(() => commands.push(0));
  state.emit({ state: 0 });
  expect(commands).toEqual([0]);
  await Promise.resolve();
  expect(commands).toEqual([0, 4500]);
  engine.dispose();
});
