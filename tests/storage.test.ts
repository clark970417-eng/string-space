import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { library } from "../src/storage/library";
import { createDemo } from "../src/music/demo";

it("orders autosaves before deletion and supports an explicit re-import", async () => {
  const piece = createDemo();
  await Promise.all([
    library.save(piece),
    library.save({ ...piece, title: "renamed" }),
    library.remove(piece.id),
  ]);
  expect(await library.all()).toEqual([]);
  await library.save(piece);
  expect((await library.all()).map((p) => p.title)).toEqual([piece.title]);
});

it("round trips original files and recognition sources as byte-backed blobs", async () => {
  const piece = createDemo();
  piece.original = new Blob(["original image bytes"], { type: "image/png" });
  piece.reference = {
    file: piece.original,
    mime: "image/png",
    markers: [],
    bpm: 80,
    numerator: 4,
    denominator: 4,
    confirmed: false,
  };
  await library.save(piece);
  const restored = (await library.all()).find((p) => p.id === piece.id)!;
  expect(restored.original).toBeInstanceOf(Blob);
  expect(restored.original!.size).toBe(20);
  expect(restored.reference!.file.type).toBe("image/png");
  const text = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsText(restored.original!);
  });
  expect(text).toBe("original image bytes");
});
