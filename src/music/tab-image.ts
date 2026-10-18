/** Conservative geometry for horizontal printed six-line tablature. No timing from spacing. */
export type Pixels = { width: number; height: number; ink: Uint8Array };
export type TabStaff = {
  lines: number[];
  gap: number;
  left: number;
  right: number;
  bars: number[];
};
export type Glyph = { x: number; y: number; w: number; h: number; string: number };
export function pixels(data: ImageData): Pixels {
  const ink = new Uint8Array(data.width * data.height);
  for (let i = 0; i < ink.length; i++) {
    const p = i * 4;
    ink[i] =
      data.data[p + 3] > 100 && (data.data[p] + data.data[p + 1] + data.data[p + 2]) / 3 < 150
        ? 1
        : 0;
  }
  return { width: data.width, height: data.height, ink };
}
export function staffGroups(p: Pixels): TabStaff[] {
  const { width: w, height: h, ink } = p;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) n += ink[y * w + x];
    if (n > w * 0.32) rows.push(y);
  }
  const bands: number[][] = [];
  for (const y of rows) {
    if (bands.length && y - bands.at(-1)!.at(-1)! <= 2) bands.at(-1)!.push(y);
    else bands.push([y]);
  }
  const centers = bands.map((b) => Math.round((b[0] + b.at(-1)!) / 2));
  const result: TabStaff[] = [];
  for (let i = 0; i + 5 < centers.length; i++) {
    const lines = centers.slice(i, i + 6),
      gap = (lines[5] - lines[0]) / 5;
    if (
      gap < 8 ||
      gap > 100 ||
      lines.slice(1).some((v, j) => Math.abs(v - lines[j] - gap) > Math.max(2, gap * 0.12))
    )
      continue;
    // Reject a seven-or-more-line grid, rather than treating arbitrary tables as TAB.
    if (centers[i + 6] && Math.abs(centers[i + 6] - lines[5] - gap) < gap * 0.15) continue;
    const xs: number[] = [];
    for (let x = 0; x < w; x++) if (lines.reduce((s, y) => s + ink[y * w + x], 0) >= 5) xs.push(x);
    if (!xs.length) continue;
    const left = xs[0],
      right = xs.at(-1)!;
    const vertical: number[] = [];
    for (let x = left; x <= right; x++) {
      let n = 0;
      for (let y = lines[0]; y <= lines[5]; y++) n += ink[y * w + x];
      if (n > (lines[5] - lines[0]) * 0.88) {
        let above = 0,
          below = 0;
        for (let k = 1; k <= gap; k++) {
          const a = lines[0] - k,
            b = lines[5] + k;
          if (a >= 0) above += ink[Math.round(a) * w + x];
          if (b < h) below += ink[Math.round(b) * w + x];
        }
        // Stems and playback cursors extend beyond the string band; barlines do not.
        if (above < gap * 0.65 && below < gap * 0.65) vertical.push(x);
      }
    }
    const bars: number[] = [];
    for (const x of vertical) {
      if (!bars.length || x - bars.at(-1)! > gap * 0.4) bars.push(x);
    }
    const boundaries = [
      left,
      ...bars.filter((x) => x > left + gap * 0.5 && x < right - gap * 0.5),
      right,
    ];
    result.push({ lines, gap, left, right, bars: boundaries });
    i += 5;
  }
  return result;
}
export function digitRegions(p: Pixels, s: TabStaff): Glyph[] {
  const result: Glyph[] = [];
  const { width: w, ink } = p;
  s.lines.forEach((line, index) => {
    const top = Math.max(0, Math.round(line - s.gap * 0.43)),
      bottom = Math.min(p.height - 1, Math.round(line + s.gap * 0.43));
    const occupied: number[] = [];
    for (let x = s.left + Math.round(s.gap * 0.4); x < s.right - s.gap * 0.2; x++) {
      if (s.bars.some((b) => Math.abs(b - x) < s.gap * 0.17)) continue;
      // The second stroke of a repeat bar must not become a fret "1".
      if (s.bars.some((b) => Math.abs(b - x) < s.gap * 0.5)) {
        let vertical = 0;
        for (let y = s.lines[0]; y <= s.lines[5]; y++) vertical += ink[y * w + x];
        if (vertical > s.gap * 4.4) continue;
      }
      let n = 0;
      for (let y = top; y <= bottom; y++) if (Math.abs(y - line) > 2) n += ink[y * w + x];
      if (n >= 2) occupied.push(x);
    }
    const groups: number[][] = [];
    for (const x of occupied) {
      if (groups.length && x - groups.at(-1)!.at(-1)! <= Math.max(2, s.gap * 0.25))
        groups.at(-1)!.push(x);
      else groups.push([x]);
    }
    for (const group of groups) {
      const x = group[0],
        end = group.at(-1)!;
      let y0 = bottom,
        y1 = top;
      for (let xx = x; xx <= end; xx++)
        for (let y = top; y <= bottom; y++)
          if (Math.abs(y - line) > 2 && ink[y * w + xx]) {
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
      if (y1 - y0 < s.gap * 0.25 || y1 - y0 > s.gap * 0.82 || end - x < 1 || end - x > s.gap * 1.6)
        continue;
      result.push({ x, y: y0, w: end - x + 1, h: y1 - y0 + 1, string: index + 1 });
    }
  });
  return result.sort((a, b) => a.x - b.x || a.string - b.string);
}
export function rhythmCandidate(
  p: Pixels,
  s: TabStaff,
  x: number,
): { duration: number; evidence: string } {
  // Only inspect visible stems and horizontal beams outside the six strings.
  const { width: w, height: h, ink } = p;
  const g = s.gap;
  for (const direction of [1, -1]) {
    const edge = direction === 1 ? s.lines[5] : s.lines[0];
    const y0 = Math.max(0, Math.floor(edge - g * 3)),
      y1 = Math.min(h - 1, Math.ceil(edge + g * 3));
    for (let xx = Math.round(x - g * 0.35); xx <= x + g * 0.35; xx++) {
      if (xx < 0 || xx >= w) continue;
      let run = 0,
        max = 0;
      for (let k = 1; k < g * 3; k++) {
        const y = Math.round(edge + direction * k);
        if (y < 0 || y >= h) break;
        run = ink[y * w + xx] ? run + 1 : 0;
        max = Math.max(max, run);
      }
      if (max < g * 0.85) continue;
      const beamRows: number[] = [];
      for (let y = y0; y <= y1; y++) {
        if (direction * (y - edge) < g * 0.5) continue;
        let left = 0,
          right = 0;
        for (let dx = 3; dx < g * 0.9; dx++) {
          if (xx - dx >= 0) left += ink[y * w + xx - dx];
          if (xx + dx < w) right += ink[y * w + xx + dx];
        }
        if (Math.max(left, right) > g * 0.55) beamRows.push(y);
      }
      let beams = 0,
        last = -100;
      for (const y of beamRows) {
        if (y - last > Math.max(2, g * 0.1)) beams++;
        last = y;
      }
      if (beams > 0 && beams <= 3)
        return {
          duration: 4 * 2 ** beams,
          evidence: `偵測到 ${beams} 道符槓；請核對附點、連音與跨拍連結`,
        };
      return { duration: 4, evidence: "偵測到符桿；四分音符候選，旗尾與附點需人工核對" };
    }
  }
  return { duration: 4, evidence: "未辨識到可靠節奏；暫填四分音符，必須依原譜設定" };
}
