import type { Pixels, TabStaff } from "./tab-image";
import type { Shape } from "./tab-rhythm";
/** Require a double bar and two isolated dots; a lone double bar is not a repeat. */
export function repeatSigns(p: Pixels, s: TabStaff, shapes: Shape[]) {
  const at = (x: number, y: number) => p.ink[Math.round(y) * p.width + Math.round(x)] ?? 0;
  return s.bars.map((x) => {
    const columns: number[] = [];
    for (
      let xx = Math.max(0, Math.floor(x - s.gap * 0.4));
      xx <= Math.min(p.width - 1, x + s.gap * 0.4);
      xx++
    ) {
      let n = 0;
      for (let y = s.lines[0]; y <= s.lines[5]; y++) n += at(xx, y);
      if (n > s.gap * 4.5 && (!columns.length || xx - columns.at(-1)! > s.gap * 0.08))
        columns.push(xx);
    }
    const double = columns.some((a, i) =>
      columns.slice(i + 1).some((b) => b - a >= s.gap * 0.14 && b - a <= s.gap * 0.4),
    );
    const dots = shapes.filter(
      (r) =>
        r.w >= s.gap * 0.1 &&
        r.w <= s.gap * 0.38 &&
        r.h >= s.gap * 0.1 &&
        r.h <= s.gap * 0.38 &&
        r.w / r.h > 0.6 &&
        r.w / r.h < 1.6,
    );
    const pair = (side: number) =>
      double &&
      dots.some((a) =>
        dots.some((b) => {
          const ax = a.x + a.w / 2,
            bx = b.x + b.w / 2,
            ay = a.y + a.h / 2,
            by = b.y + b.h / 2;
          return (
            side * (ax - x) > s.gap * 0.35 &&
            side * (ax - x) < s.gap * 1.1 &&
            Math.abs(ax - bx) < s.gap * 0.15 &&
            by - ay > s.gap * 0.6 &&
            by - ay < s.gap * 2.1 &&
            Math.abs((ay + by) / 2 - (s.lines[0] + 2.5 * s.gap)) < s.gap * 0.4
          );
        }),
      );
    return { start: pair(1), end: pair(-1) };
  });
}
/** Closed horizontal brackets with a left down-hook. OCR must separately read 1 or 2. */
export function endingBrackets(p: Pixels, s: TabStaff) {
  const out: { left: number; right: number; y: number; first: number; last: number }[] = [];
  const at = (x: number, y: number) => p.ink[Math.round(y) * p.width + Math.round(x)] ?? 0;
  for (
    let y = Math.max(0, Math.floor(s.lines[0] - s.gap * 2.8));
    y < s.lines[0] - s.gap * 0.8;
    y++
  ) {
    let start = -1;
    for (let x = s.left; x <= s.right + 1; x++) {
      if (x <= s.right && at(x, y)) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        const end = x - 1;
        if (
          end - start > s.gap * 2 &&
          !out.some(
            (r) => Math.abs(r.y - y) < s.gap * 0.2 && Math.abs(r.left - start) < s.gap * 0.3,
          )
        ) {
          const first = s.bars.findIndex((b) => Math.abs(b - start) < s.gap * 0.4);
          const last = s.bars.findIndex((b) => Math.abs(b - end) < s.gap * 0.4) - 1;
          let hook = 0;
          for (let dy = 1; dy < s.gap * 0.5; dy++)
            if ([-1, 0, 1, 2].some((dx) => at(start + dx, y + dy))) hook++;
          if (first >= 0 && last >= first && hook > s.gap * 0.3)
            out.push({ left: start, right: end, y, first, last });
        }
        start = -1;
      }
    }
  }
  return out;
}
