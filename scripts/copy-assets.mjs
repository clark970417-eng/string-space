import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
await mkdir("public/licenses", { recursive: true });
await cp("node_modules/@coderline/alphatab/LICENSE", "public/licenses/alphaTab-MPL-2.0.txt");
await cp(
  "node_modules/@coderline/alphatab/dist/soundfont/LICENSE",
  "public/licenses/SONiVOX-NOTICE.txt",
);
await cp(
  "node_modules/@coderline/alphatab/dist/font/Bravura-OFL.txt",
  "public/licenses/Bravura-OFL.txt",
);
await cp("node_modules/pdfjs-dist/LICENSE", "public/licenses/PDFjs-Apache-2.0.txt");
for (const name of ["react", "react-dom", "scheduler", "lucide-react", "idb", "fflate"])
  await cp(`node_modules/${name}/LICENSE`, `public/licenses/${name}-LICENSE.txt`);
// fft.js publishes its MIT notice in README.md rather than a separate LICENSE file.
const fftReadme = await readFile("node_modules/fft.js/README.md", "utf8");
await writeFile(
  "public/licenses/fft.js-LICENSE.txt",
  fftReadme.slice(fftReadme.indexOf("#### LICENSE")),
);
// alphaTab's official Vite plugin serves/copies font and SoundFont assets.
await mkdir("public/ocr/core", { recursive: true });
await cp("node_modules/tesseract.js/dist/worker.min.js", "public/ocr/worker.min.js");
const { readdir } = await import("node:fs/promises");
for (const file of await readdir("node_modules/tesseract.js-core"))
  if (file.endsWith(".wasm") || file.endsWith(".wasm.js"))
    await cp(`node_modules/tesseract.js-core/${file}`, `public/ocr/core/${file}`);
await cp(
  "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "public/ocr/eng.traineddata.gz",
);
await cp("node_modules/tesseract.js/LICENSE.md", "public/licenses/Tesseract-js-Apache-2.0.txt");
await cp("node_modules/tesseract.js-core/LICENSE", "public/licenses/Tesseract-core-Apache-2.0.txt");
