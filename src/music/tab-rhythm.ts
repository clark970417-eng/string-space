import { pixels, type Pixels, type TabStaff } from "./tab-image";

export type Shape = { x: number; y: number; w: number; h: number; points: number[] };
export type SymbolTemplate = {
  kind: "rest" | "tuplet";
  value: number;
  ratio: number;
  mask: Uint8Array;
};
export type RhythmEvent = {
  x: number;
  duration: number;
  dots: number;
  tuplet: number;
  tex: string;
  evidence: string[];
};
const SIZE = 32;

/** Connected ink after removing only long, bare string pixels. Strokes crossing strings survive. */
export function rhythmShapes(p: Pixels, s: TabStaff): Shape[] {
  const left = Math.max(0, Math.floor(s.left + 3)),
    right = Math.min(p.width - 1, Math.ceil(s.right - 3));
  const top = Math.max(0, Math.floor(s.lines[0] - 3 * s.gap)),
    bottom = Math.min(p.height - 1, Math.ceil(s.lines[5] + 3 * s.gap));
  const w = right - left + 1,
    h = bottom - top + 1,
    bits = new Uint8Array(w * h);
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      if (!p.ink[y * p.width + x] || s.bars.some((b) => Math.abs(b - x) < 3)) continue;
      const line = s.lines.find((l) => Math.abs(l - y) <= 2);
      if (
        line !== undefined &&
        !p.ink[(line - 3) * p.width + x] &&
        !p.ink[(line + 3) * p.width + x]
      )
        continue;
      bits[(y - top) * w + x - left] = 1;
    }
  const shapes: Shape[] = [];
  for (let pos = 0; pos < bits.length; pos++) {
    if (!bits[pos]) continue;
    const queue = [pos];
    bits[pos] = 0;
    let x0 = w,
      x1 = 0,
      y0 = h,
      y1 = 0;
    const points: number[] = [];
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i],
        x = k % w,
        y = Math.floor(k / w);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      points.push((y + top) * p.width + x + left);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            n = yy * w + xx;
          if (xx >= 0 && xx < w && yy >= 0 && yy < h && bits[n]) {
            bits[n] = 0;
            queue.push(n);
          }
        }
    }
    if (points.length >= 3)
      shapes.push({ x: x0 + left, y: y0 + top, w: x1 - x0 + 1, h: y1 - y0 + 1, points });
  }
  return shapes;
}
export function shapeMask(shape: Shape, width: number): Uint8Array {
  const mask = new Uint8Array(SIZE * SIZE);
  for (const k of shape.points) {
    const x = (k % width) - shape.x,
      y = Math.floor(k / width) - shape.y;
    for (
      let yy = Math.floor((y * SIZE) / shape.h);
      yy < Math.ceil(((y + 1) * SIZE) / shape.h);
      yy++
    )
      for (
        let xx = Math.floor((x * SIZE) / shape.w);
        xx < Math.ceil(((x + 1) * SIZE) / shape.w);
        xx++
      )
        mask[yy * SIZE + xx] = 1;
  }
  return mask;
}
export function matchSymbol(
  shape: Shape,
  width: number,
  templates: SymbolTemplate[],
  kind: SymbolTemplate["kind"],
) {
  const mask = shapeMask(shape, width);
  const scored = templates
    .filter((t) => t.kind === kind && Math.abs(Math.log(shape.w / shape.h / t.ratio)) < 0.28)
    .map((t) => {
      let intersection = 0,
        total = 0;
      for (let i = 0; i < mask.length; i++) {
        intersection += mask[i] & t.mask[i];
        total += mask[i] + t.mask[i];
      }
      return { value: t.value, score: total ? (2 * intersection) / total : 0 };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0],
    other = scored.find((v) => v.value !== best?.value);
  return best && best.score >= 0.81 && (!other || best.score - other.score > 0.055)
    ? best
    : undefined;
}
let cached: Promise<SymbolTemplate[]> | undefined;
export function symbolTemplates(): Promise<SymbolTemplate[]> {
  return (cached ??= (async () => {
    const font = await new FontFace("TabRhythmBravura", "url(/font/Bravura.woff2)").load();
    document.fonts.add(font);
    const templates: SymbolTemplate[] = [];
    const symbols: { kind: SymbolTemplate["kind"]; value: number; char: string; font: string }[] =
      [];
    for (const [value, code] of [
      [4, 0xe4e5],
      [8, 0xe4e6],
      [16, 0xe4e7],
      [32, 0xe4e8],
    ])
      symbols.push({
        kind: "rest",
        value,
        char: String.fromCodePoint(code),
        font: "TabRhythmBravura",
      });
    for (const value of [3, 5, 6]) {
      symbols.push({
        kind: "tuplet",
        value,
        char: String.fromCodePoint(0xe880 + value),
        font: "TabRhythmBravura",
      });
      for (const font of ["Arial", "Times New Roman"])
        symbols.push({ kind: "tuplet", value, char: String(value), font });
    }
    for (const symbol of symbols) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "black";
      ctx.font = `80px "${symbol.font}"`;
      ctx.fillText(symbol.char, 90, 140);
      const p = pixels(ctx.getImageData(0, 0, 256, 256));
      const shape = rhythmShapes(p, {
        left: 0,
        right: 255,
        lines: [0, 0, 0, 255, 255, 255],
        gap: 90,
        bars: [],
      }).sort((a, b) => b.points.length - a.points.length)[0];
      if (shape)
        templates.push({
          kind: symbol.kind,
          value: symbol.value,
          ratio: shape.w / shape.h,
          mask: shapeMask(shape, 256),
        });
    }
    return templates;
  })().catch((error) => {
    cached = undefined;
    throw error;
  }));
}

export function restCandidates(
  p: Pixels,
  s: TabStaff,
  shapes: Shape[],
  templates: SymbolTemplate[],
  noteXs: number[],
) {
  return shapes.flatMap((shape) => {
    if (
      shape.h < s.gap * 0.45 ||
      shape.h > s.gap * 2.8 ||
      shape.w > s.gap * 1.3 ||
      noteXs.some((x) => Math.abs(x - shape.x - shape.w / 2) < s.gap * 0.55)
    )
      return [];
    const match = matchSymbol(shape, p.width, templates, "rest");
    return match ? [{ shape, duration: match.value }] : [];
  });
}

/** Dots need a compact, round ink component to the right of the event, away from barlines. */
export function augmentationDots(
  s: TabStaff,
  shapes: Shape[],
  x: number,
  anchorYs: number[],
  nextX: number,
) {
  const candidates = shapes.filter(
    (c) =>
      c.w >= Math.max(2, s.gap * 0.07) &&
      c.w <= s.gap * 0.26 &&
      c.h >= Math.max(2, s.gap * 0.07) &&
      c.h <= s.gap * 0.26 &&
      c.w / c.h > 0.65 &&
      c.w / c.h < 1.5 &&
      c.points.length / (c.w * c.h) > 0.6 &&
      c.x > x + s.gap * 0.25 &&
      c.x < Math.min(nextX - s.gap * 0.3, x + s.gap * 1.35) &&
      !s.bars.some((b) => Math.abs(c.x - b) < s.gap * 0.7) &&
      anchorYs.some((y) => Math.abs(c.y + c.h / 2 - y) < s.gap * 0.24),
  );
  // Multiple vertically stacked dots are repeat/chord marks, not multiple augmentation dots.
  const row = candidates.sort((a, b) => a.x - b.x);
  if (
    row.length > 2 ||
    (row.length === 2 &&
      (Math.abs(row[0].y - row[1].y) > s.gap * 0.15 || row[1].x - row[0].x < s.gap * 0.18))
  )
    return 0;
  return row.length;
}

/** Only explicit bracket + recognized numeral + exactly N equal events qualifies. */
export function applyTuplets(
  p: Pixels,
  s: TabStaff,
  shapes: Shape[],
  templates: SymbolTemplate[],
  events: RhythmEvent[],
  messages: string[],
) {
  for (const shape of shapes) {
    const cy = shape.y + shape.h / 2;
    if (cy > s.lines[0] - s.gap * 0.5 && cy < s.lines[5] + s.gap * 0.5) continue;
    if (shape.h < s.gap * 0.3 || shape.h > s.gap * 1.1 || shape.w > s.gap) continue;
    const match = matchSymbol(shape, p.width, templates, "tuplet");
    if (!match) continue;
    const cx = shape.x + shape.w / 2;
    // Find horizontal bracket segments on both sides with end hooks, at the numeral's middle.
    const segments: { a: number; b: number; y: number }[] = [];
    for (let y = Math.floor(cy - shape.h * 0.3); y <= cy + shape.h * 0.3; y++) {
      let start = -1;
      for (let x = Math.ceil(s.left + 3); x <= s.right - 3; x++) {
        if (p.ink[y * p.width + x]) {
          if (start < 0) start = x;
        } else if (start >= 0) {
          if (x - start > s.gap * 0.7) segments.push({ a: start, b: x - 1, y });
          start = -1;
        }
      }
    }
    const l = segments
      .filter((v) => v.b < shape.x && shape.x - v.b < s.gap * 0.6)
      .sort((a, b) => b.b - a.b)[0];
    const r = segments
      .filter(
        (v) =>
          v.a > shape.x + shape.w &&
          v.a - shape.x - shape.w < s.gap * 0.6 &&
          (!l || Math.abs(v.y - l.y) < 3),
      )
      .sort((a, b) => a.a - b.a)[0];
    const hook = (x: number, y: number) =>
      [1, -1].some((d) => {
        let n = 0;
        for (let k = 2; k < s.gap * 0.35; k++) if (p.ink[Math.round(y + d * k) * p.width + x]) n++;
        return n > s.gap * 0.17;
      });
    if (!l || !r || !hook(l.a, l.y) || !hook(r.b, r.y)) {
      messages.push(`疑似 ${match.value} 連音數字，但範圍不明；請手動設定連音。`);
      continue;
    }
    const group = events.filter((e) => e.x >= l.a - s.gap * 0.45 && e.x <= r.b + s.gap * 0.45);
    if (
      group.length !== match.value ||
      group.some((e) => e.duration !== group[0].duration || e.dots || e.tuplet) ||
      !group.some((e) => e.x < cx) ||
      !group.some((e) => e.x > cx)
    ) {
      messages.push(`疑似 ${match.value} 連音括號，但事件數或時值不一致；未自動套用。`);
      continue;
    }
    for (const e of group) {
      e.tuplet = match.value;
      e.evidence.push(
        `括號與數字 ${match.value}：${match.value}:${match.value === 3 ? 2 : 4} 連音候選，請核對整組範圍`,
      );
    }
  }
}
export function rhythmTex(event: RhythmEvent) {
  const effects = [
    event.dots === 1 ? "d" : event.dots === 2 ? "dd" : "",
    event.tuplet ? `tu ${event.tuplet} ${event.tuplet === 3 ? 2 : 4}` : "",
  ].filter(Boolean);
  return `${event.tex}.${event.duration}${effects.length ? ` { ${effects.join(" ")} }` : ""}`;
}

/** Whole/half rests require a filled block attached to a visible supporting line.
 * A floating rectangle is ambiguous and is deliberately not guessed. */
export function blockRestCandidates(p: Pixels, s: TabStaff) {
  const result: { shape: Shape; duration: number }[] = [];
  const g = s.gap,
    minW = Math.max(5, Math.floor(g * 0.35)),
    maxW = Math.ceil(g * 1.15);
  const at = (x: number, y: number) =>
    x >= 0 && x < p.width && y >= 0 && y < p.height ? p.ink[y * p.width + x] : 0;
  for (
    let y = Math.max(1, Math.floor(s.lines[0] - 2 * g));
    y < Math.min(p.height - 2, s.lines[5] + 2 * g);
    y++
  ) {
    let start = -1;
    for (let x = Math.ceil(s.left + g * 0.4); x < s.right - g * 0.4; x++) {
      if (at(x, y) && at(x, y + 1) && at(x, y - 1)) {
        if (start < 0) start = x;
        continue;
      }
      if (start < 0) continue;
      const a = start,
        b = x - 1;
      start = -1;
      if (
        b - a + 1 < minW ||
        b - a + 1 > maxW ||
        s.bars.some((v) => v > a - g * 0.2 && v < b + g * 0.2)
      )
        continue;
      let top = y,
        bottom = y;
      const filled = (yy: number) => {
        let n = 0;
        for (let xx = a; xx <= b; xx++) n += at(xx, yy);
        return n / (b - a + 1) > 0.85;
      };
      while (top > 0 && y - top < g && filled(top - 1)) top--;
      while (bottom < p.height - 1 && bottom - y < g && filled(bottom + 1)) bottom++;
      const h = bottom - top + 1;
      if (
        h < g * 0.14 ||
        h > g * 0.48 ||
        result.some((r) => Math.abs(r.shape.x - a) < g * 0.2 && Math.abs(r.shape.y - top) < g * 0.5)
      )
        continue;
      const support = (yy: number) => {
        let l = 0,
          r = 0;
        for (let dx = 3; dx <= g * 0.4; dx++) {
          l += at(a - dx, yy);
          r += at(b + dx, yy);
        }
        return l > g * 0.22 && r > g * 0.22;
      };
      const above = [top - 1, top, top + 1].some(support),
        below = [bottom - 1, bottom, bottom + 1].some(support);
      if (above === below) continue;
      // A rest is an isolated block. Numerals such as the time-signature 4
      // can have a rectangular foot on a string, but carry ink above it.
      let outsideInk = 0;
      for (let xx = a; xx <= b; xx++)
        for (let d = 3; d <= g * 0.45; d++) {
          outsideInk += at(xx, top - d) + at(xx, bottom + d);
        }
      if (outsideInk > (b - a + 1) * 0.18 || (b - a + 1) / h < 1.6 || (b - a + 1) / h > 4.5)
        continue;
      // Reject stem/beam junctions and thick table rules.
      const center = Math.round((a + b) / 2);
      if (at(center, top - 4) && at(center, bottom + 4)) continue;
      const points: number[] = [];
      for (let yy = top; yy <= bottom; yy++)
        for (let xx = a; xx <= b; xx++) if (at(xx, yy)) points.push(yy * p.width + xx);
      result.push({ shape: { x: a, y: top, w: b - a + 1, h, points }, duration: above ? 1 : 2 });
    }
  }
  return result;
}

/** A visible arch between adjacent same-string notes, never merely equal pitches. */
export function hasTieArc(p: Pixels, s: TabStaff, x1: number, x2: number, string: number) {
  const g = s.gap,
    left = x1 + g * 0.45,
    right = x2 - g * 0.45;
  if (right - left < g * 0.8) return false;
  const ink = (x: number, y: number) =>
    x >= 0 && x < p.width && y >= 0 && y < p.height && p.ink[y * p.width + x];
  for (const direction of [-1, 1])
    for (let offset = 0.4; offset <= 1.01; offset += 0.1)
      for (let depth = 0.25; depth <= 1.01; depth += 0.1) {
        const baseline = s.lines[string - 1] + direction * offset * g;
        let hits = 0,
          total = 0,
          flat = 0;
        for (let i = 0; i <= 64; i++) {
          const t = i / 64,
            x = Math.round(left + t * (right - left));
          if (s.bars.some((b) => Math.abs(b - x) < 3)) continue;
          const y = Math.round(baseline + direction * depth * g * 4 * t * (1 - t));
          let found = false;
          for (
            let dy = -Math.max(1, Math.round(g * 0.06));
            dy <= Math.max(1, Math.round(g * 0.06));
            dy++
          )
            if (ink(x, y + dy)) found = true;
          hits += Number(found);
          total++;
          flat += Number(!!ink(x, Math.round(baseline)));
        }
        if (total > 48 && hits / total > 0.91 && flat / total < 0.45) return true;
      }
  return false;
}

/** Paired system-edge half arches; equal pitches alone are never evidence. */
export function boundaryTieDirections(
  p: Pixels,
  s: TabStaff,
  noteX: number,
  string: number,
  side: "in" | "out",
): number[] {
  const g = s.gap;
  const edge = side === "out" ? s.bars[s.bars.length - 1] - g * 0.15 : s.bars[0] + g * 0.15;
  const start = noteX + (side === "out" ? 1 : -1) * g * 0.45;
  if (Math.abs(edge - start) < g * 0.8 || Math.abs(edge - start) > g * 8) return [];
  const at = (x: number, y: number) =>
    x >= 0 && x < p.width && y >= 0 && y < p.height && !!p.ink[y * p.width + x];
  return [-1, 1].filter((direction) => {
    for (let offset = 0.4; offset <= 1.01; offset += 0.1)
      for (let depth = 0.35; depth <= 1.01; depth += 0.1) {
        const base = s.lines[string - 1] + direction * offset * g;
        let hits = 0,
          flat = 0;
        for (let i = 0; i <= 64; i++) {
          const t = i / 64,
            x = Math.round(start + (edge - start) * t);
          const y = Math.round(base + direction * depth * g * (2 * t - t * t));
          let hit = false;
          for (
            let dy = -Math.max(1, Math.round(g * 0.06));
            dy <= Math.max(1, Math.round(g * 0.06));
            dy++
          )
            hit ||= at(x, y + dy);
          hits += +hit;
          flat += +at(x, Math.round(base));
        }
        if (hits / 65 > 0.93 && flat / 65 < 0.4) return true;
      }
    return false;
  });
}
