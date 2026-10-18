import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = resolve(".omr-runtime");
if (process.platform !== "darwin")
  throw Error(
    "自動安裝支援 macOS。其他系統請安裝 Audiveris 5.11.0，設定 AUDIVERIS_BIN 為命令列執行檔後執行 npm run omr。",
  );
const arch = process.arch === "arm64" ? "arm64" : "x86_64";
const hash =
  arch === "arm64"
    ? "17491af8b6d40153b031dd1f0815e37213f0999ef23f10586af46706e59b2eb6"
    : "11794424c6f1698617836a77d2c5818c46405a3fe7388281c623c4e383fa33cb";
const exe = join(root, "Audiveris.app/Contents/MacOS/Audiveris");
try {
  await access(exe);
  console.log("Audiveris 已安裝：" + exe);
  process.exit(0);
} catch {}
await mkdir(root, { recursive: true });
console.log(
  "下載官方 Audiveris 5.11.0（AGPL-3.0）。授權及原始碼：https://github.com/Audiveris/audiveris/tree/5.11.0",
);
const response = await fetch(
  `https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-macosx-${arch}.dmg`,
);
if (!response.ok) throw Error("下載失敗：" + response.status);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== hash)
  throw Error("下載檔案 SHA-256 不符，未安裝。");
const dmg = join(root, "Audiveris.dmg"),
  mount = join(root, "mount");
await writeFile(dmg, bytes);
await mkdir(mount, { recursive: true });
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: "utf8" });
  if (r.status !== 0) throw Error(r.stderr || r.stdout || `${cmd} failed`);
  return r.stdout;
};
try {
  await writeFile(
    join(root, "install.log"),
    run("hdiutil", ["attach", dmg, "-nobrowse", "-readonly", "-mountpoint", mount], "Y\n"),
  );
  run("ditto", [join(mount, "Audiveris.app"), join(root, "Audiveris.app")]);
} finally {
  spawnSync("hdiutil", ["detach", mount], { encoding: "utf8" });
}
console.log("安裝完成。執行 npm run omr 啟動本機辨識服務；不會開啟 Audiveris 視窗。");
