import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, access } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
const port = Number(process.env.OMR_PORT || 4281);
const executable =
  process.env.AUDIVERIS_BIN || resolve(".omr-runtime/Audiveris.app/Contents/MacOS/Audiveris");
const hosts = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  ...Object.values(networkInterfaces())
    .flat()
    .filter(Boolean)
    .map((x) => x.address),
]);
const jobs = new Map();
let running = false;
const send = (res, code, value) => {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
};
async function available() {
  try {
    await access(executable);
    return true;
  } catch {
    return false;
  }
}
async function run(job, bytes, extension, pages) {
  running = true;
  job.status = "running";
  job.stage = "讀取譜面";
  const dir = await mkdtemp(join(tmpdir(), "string-space-omr-"));
  job.dir = dir;
  try {
    const input = join(dir, `score.${extension}`);
    await writeFile(input, bytes);
    const args = ["-batch", "-transcribe", "-export", "-output", dir];
    if (extension === "pdf") args.push("-sheets", ...pages);
    args.push("--", input);
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, JAVA_TOOL_OPTIONS: "-Xmx1536m -Djava.awt.headless=true" },
    });
    job.child = child;
    const stages = {
      LOAD: "讀取譜面",
      BINARY: "處理圖像",
      SCALE: "尋找譜線",
      GRID: "尋找小節與聲部",
      HEADERS: "辨識譜號與拍號",
      HEADS: "辨識音符",
      STEMS: "辨識符尾",
      TEXTS: "辨識文字",
      RHYTHMS: "分析節奏",
      PAGE: "建立數位譜",
    };
    let log = "";
    const collect = (chunk) => {
      const text = chunk.toString();
      log = (log + text).slice(-60000);
      for (const [key, label] of Object.entries(stages))
        if (new RegExp("\\b" + key + "\\b").test(text)) job.stage = label;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      job.timedOut = true;
      child.kill("SIGKILL");
    }, 180000);
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    }).finally(() => clearTimeout(timer));
    if (job.cancelled) return;
    if (job.timedOut) throw Error("辨識超過三分鐘。請分頁上傳，或使用清晰、裁正的譜面。");
    const files = (await readdir(dir)).filter((n) => n.endsWith(".mxl")).sort();
    if (code !== 0 || !files.length)
      throw Error(
        "未能辨識出可用的五線譜。請裁除背景、提高解析度，或改用手動輸入。純六線譜目前不支援自動辨識。",
      );
    const outputs = [];
    for (const name of files) {
      const data = await readFile(join(dir, name));
      if (data.length > 20 * 1024 * 1024) throw Error("辨識結果過大，請分頁處理。");
      outputs.push({ name, data: data.toString("base64") });
    }
    job.outputs = outputs;
    job.warnings = log
      .split("\n")
      .filter((l) => /WARN|ERROR/.test(l))
      .slice(-12)
      .map((l) => l.replace(/.*\|\s*/, "").replaceAll(dir, "[暫存資料夾]"));
    job.status = "done";
    job.stage = "辨識完成，請校對";
  } catch (e) {
    if (!job.cancelled) {
      job.status = "error";
      job.error = e.message;
    }
  } finally {
    job.child = undefined;
    await rm(dir, { recursive: true, force: true });
    running = false;
    job.finished = Date.now();
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const host = new URL("http://" + req.headers.host).hostname;
    if (!hosts.has(host)) return send(res, 403, { error: "不允許的主機" });
    const origin = req.headers.origin;
    if (origin) {
      let o;
      try {
        o = new URL(origin);
      } catch {
        return send(res, 403, { error: "不允許的來源" });
      }
      if (
        !hosts.has(o.hostname) ||
        !["4178", "5178", String(port)].includes(o.port) ||
        o.protocol !== "http:"
      )
        return send(res, 403, { error: "不允許的來源" });
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-OMR-Request",
      });
      return res.end();
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/health" && req.method === "GET")
      return send(res, 200, {
        ready: await available(),
        engine: "Audiveris 5.11.0",
        local: true,
        busy: running,
      });
    if (req.method === "POST" && url.pathname === "/jobs") {
      if (req.headers["x-omr-request"] !== "1") return send(res, 403, { error: "缺少請求標記" });
      if (running) return send(res, 409, { error: "本機正在辨識另一份樂譜，請稍候再試。" });
      if (!(await available()))
        return send(res, 503, { error: "本機辨識引擎尚未安裝，請執行 npm run omr:setup。" });
      const ext = url.searchParams.get("type");
      if (!["png", "jpg", "pdf"].includes(ext))
        return send(res, 400, { error: "只接受 PNG、JPG、PDF。" });
      const spec = url.searchParams.get("pages") || "1";
      if (!/^\d{1,3}(?:-\d{1,3})?(?:,\d{1,3}(?:-\d{1,3})?)*$/.test(spec))
        return send(res, 400, { error: "頁碼格式不正確。" });
      const selected = new Set();
      for (const segment of spec.split(",")) {
        const [a, b = a] = segment.split("-").map(Number);
        if (a < 1 || b < a || b > 999 || b - a > 7)
          return send(res, 400, { error: "每次最多辨識 8 頁。" });
        for (let i = a; i <= b; i++) selected.add(i);
      }
      if (selected.size > 8) return send(res, 400, { error: "每次最多辨識 8 頁。" });
      let size = 0;
      const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > 35 * 1024 * 1024) return send(res, 413, { error: "檔案請小於 35 MB。" });
        chunks.push(c);
      }
      const bytes = Buffer.concat(chunks);
      const valid =
        ext === "pdf"
          ? bytes.subarray(0, 5).toString() === "%PDF-"
          : ext === "png"
            ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes[0] === 255 && bytes[1] === 216;
      if (!valid) return send(res, 400, { error: "檔案內容與格式不符。" });
      if (running) return send(res, 409, { error: "本機正在辨識另一份樂譜，請稍候再試。" });
      const job = { id: randomUUID(), status: "queued", created: Date.now() };
      jobs.set(job.id, job);
      void run(job, bytes, ext, [...selected].sort((a, b) => a - b).map(String));
      return send(res, 202, { id: job.id });
    }
    const id = url.pathname.match(/^\/jobs\/([\w-]+)$/)?.[1],
      job = jobs.get(id);
    if (job && req.method === "GET")
      return send(res, 200, {
        id: job.id,
        status: job.status,
        stage: job.stage,
        error: job.error,
        outputs: job.outputs,
        warnings: job.warnings,
      });
    if (job && req.method === "DELETE" && req.headers["x-omr-request"] === "1") {
      job.cancelled = true;
      job.status = "cancelled";
      job.child?.kill("SIGKILL");
      jobs.delete(id);
      return send(res, 200, { cancelled: true });
    }
    send(res, 404, { error: "找不到辨識工作，請重新辨識。" });
  } catch {
    if (!res.headersSent) send(res, 500, { error: "本機辨識服務發生錯誤，請重試。" });
  }
});
server.requestTimeout = 30000;
setInterval(() => {
  for (const [id, j] of jobs)
    if (Date.now() - (j.finished || j.created) > 600000 && !j.child) jobs.delete(id);
}, 60000).unref();
server.listen(port, "0.0.0.0", () =>
  console.log(`Local OMR: http://localhost:${port} (Audiveris, no third-party uploads)`),
);
