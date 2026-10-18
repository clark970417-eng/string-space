# String Space

A local-first guitar practice app with a Traditional Chinese interface and no sign-in: import scores, play synthesized guitar audio, practice slow loops, or automatically align your own recording with a PDF and follow the original score.

[Source on GitHub](https://github.com/clark970417-eng/string-space) · [Test report](TEST_REPORT.md)

![Guitar practice interface](artifacts/desktop-initial.png)

## Getting started

Requires Node.js 22.12 or later (Node.js 24 recommended) and npm.

```sh
git clone https://github.com/clark970417-eng/string-space.git
cd string-space
npm ci
npm run dev
```

Open <http://localhost:5178/>. Press Play to try the original 16-bar demo, “A Slow Afternoon.” If the port is occupied, use `npm run dev -- --port 5189`.

```sh
npm run build
npm run preview -- --port 4178
```

The production preview runs at <http://localhost:4178/>. The `dist/` directory includes soundfonts, fonts, OCR resources, and the PDF worker. Deploy it at the root of a static HTTP/HTTPS host; do not open the HTML file directly. Deployment under a subpath requires adjusting root-relative asset URLs.

## Automatically align a PDF with audio

The app currently uses Traditional Chinese interface labels; their English meanings are given below.

1. Upload a PDF, select Guitar tablature, choose the pages to recognize, and start recognition.
2. Compare the original and digital scores. Check tuning, capo, strings, frets, notes, and rhythm. Confirm each bar, then choose Confirm all and play synthesized audio.
3. Choose Pair audio, upload your recording, and select Automatically analyze and align audio. You do not need to enter a time for every bar.
4. The app decodes and analyzes the audio locally, proposing timestamps for each bar occurrence and the ending. Choose Preview automatic score following to compare the original PDF or digital score. Weak matches are flagged for review.
5. Edit any timestamp or mark it using the current audio position. After listening and correcting the alignment, check the confirmation box and save. The app switches to Use my audio mode.

During playback, the actual recognized regions of the PDF are highlighted, with the cursor and page following the audio clock. You can switch to the corrected digital score. Older recognition data without region coordinates can still align and follow the digital score; recognize the PDF again to obtain original-page regions. Scores with only manually drawn bar regions and no notes retain manual timing tools and offer a way to start note recognition.

![Automatic alignment preview and manual corrections](artifacts/auto-alignment-chromium.png)

### Alignment capabilities and limitations

- Uses actual notes, ties, repeats, and tempo changes from the native MIDI export to build the selected part's pitch and timing reference.
- Matches recording chroma features using subsequence DTW, allowing introductions, endings, and tempo changes. You do not need to mark the introduction manually.
- Audio and score duration are each limited to 10 minutes; audio files must be smaller than 100 MB. A local background worker supports cancellation, errors, and timeouts. The approximate local tempo-matching range is 0.5–2 times the reference; more extreme changes or different performance orders require trimming or manual editing.
- Similarity measures pitch-feature agreement; **it is not an accuracy percentage**. Users must preview and confirm candidates. Repeated passages, weak matches, and silent bars may need correction.
- Silent, unrelated, very short, or insufficiently varied recordings are rejected without overwriting existing manual timestamps.
- Accurate note data representative of the recording is required. Image-only PDFs must first be recognized and corrected. Dense accompaniment, vocals, noise, transposition, missing notes, or extra repeats can cause mismatches.
- Within each bar, the cursor interpolates between timestamps; it does not acoustically track individual notes. Automatic alignment does not guarantee accurate reconstruction of arbitrary PDFs or commercial recordings.

The acoustic method follows [AudioLabs FMP: Subsequence DTW](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C7/C7S2_SubsequenceDTW.html). FFT processing uses unmodified [fft.js 4.0.4](https://github.com/indutny/fft.js), licensed under MIT. The implementation, parameters, confidence warnings, and UI integration are included in this project and covered by reproducible tests.

## Features

- Tablature, standard notation, or combined views; synthesized guitar audio with synchronized note and bar cursors.
- Play, pause, timeline seeking, click-to-seek bars, pitch-preserving speed changes, volume, metronome, and a one-bar count-in.
- A–B loops, smooth automatic following, temporary follow suspension while browsing, and a return-to-playback-position control.
- Desktop, mobile, landscape, and focused practice layouts; local library search, renaming, and deletion.
- Original JPG, PNG, and PDF previews with recognition → correction → confirmation, saved drafts, and manual editing.
- Chord entry and configurable beats for practice accompaniment, clearly distinguished from complete score playback.

Synthesized playback generates guitar audio from the score. Uploaded recordings play through the media player and are never replaced with demo audio.

## Supported formats

| File | Handling |
| --- | --- |
| `.musicxml`, `.xml` | Parses MusicXML score-partwise, preserving notes, time signatures, tempos, repeats, strings, frets, capo, and other data supported by the engine. |
| `.mxl` | Decompresses locally, then parses MusicXML. |
| `.jpg`, `.jpeg`, `.png` | Original-image preview, local tablature recognition, manual correction, and bar marking. |
| `.pdf` | PDF.js page previews; select up to eight pages for recognition. Corrected notes can be automatically aligned with a recording. |
| `.wav`, `.mp3`, `.m4a` | Recording pairing depends on browser decoding support. Automated file tests use PCM WAV. |
| Guitar Pro, MusicXML score-timewise | Not enabled. Export score-partwise MusicXML from notation software first. |

When only pitches are provided, without strings and frets, the tablature is labeled as system-suggested fingering. Preservation of advanced techniques depends on the alphaTab importer.

### Tablature recognition

Designed for clear, horizontal printed scores. Recognition runs in the browser using Tesseract.js and score geometry to propose strings and frets, visible stems and beams, rests, dotted rhythms, bracketed triplets/quintuplets/sextuplets, ties between adjacent identical notes on the same string, clear repeats, and first/second endings. Ties across systems and consecutive pages require compatible partial arcs at both ends. Whole and half rests require a supporting line.

Each bar's beat count must be reviewed and confirmed. Nested repeats support up to two levels, with 2–4 passes each, without combining endings. D.C./D.S., al Fine, Segno, and Fine can be entered manually, but cannot currently be combined with repeats or endings. Conditional ties across repeat, ending, or jump boundaries, Coda, multiple jumps, handwriting, angled photographs, and complex multi-column layouts remain limited. Failed recognition preserves the original score and manual fallback tools.

### Optional standard-notation recognition service

Standard notation uses a separate local Audiveris 5.11.0 service to produce real MusicXML for correction. Tablature recognition and automatic audio alignment do not require this service.

```sh
npm run omr:setup
npm run omr
```

The installer supports macOS Apple Silicon and Intel, with a download of approximately 85 MB. The service runs on port 4281. On other systems, install Audiveris separately and set `AUDIVERIS_BIN`; local recognition on Windows and Linux has not been tested. Only after the user requests recognition does the app send the original score to port 4281 on the same host, rather than an external service. Public HTTPS deployments do not currently integrate this local service.

## Synchronization, storage, and privacy

- Synthesized playback follows the alphaSynth audio clock. Recording playback follows `HTMLAudioElement.currentTime`. Visual animations only read that clock.
- Pause, seeking, and loops use the same playback state. Switching away from the app or an audio interruption pauses playback; you can resume when you return.
- IndexedDB stores scores, original files, recordings, alignment candidates, manual corrections, and practice positions. No account or cloud sync is required. Clearing site data removes the local library.
- Editing and reconfirming a score removes its old recording map to avoid reusing incorrect timestamps after bar changes.
- Soundfonts, fonts, PDF resources, and OCR resources are served by the app. Audio analysis does not upload recordings to an external service.
- Pitch-preserving recording speed changes depend on browser `preservesPitch` support; speed controls are disabled when unsupported. Recording mode does not provide the synthesized metronome or count-in. Use the device volume buttons on iOS.
- Recording loops may contain decoding gaps and are not sample-accurate seamless loops. Physical iPhones, Bluetooth latency, and arbitrary recording codecs have not been fully verified.

## Testing

```sh
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run build
npm run preview -- --port 4178
```

In another terminal, test the production build:

```sh
PRACTICE_TEST_URL=http://localhost:4178 npm run test:tab
npm run test:production
```

- Playwright development tests use port 5189; the production preview uses 4178.
- Automatic alignment tests: `npx playwright test tests/browser/auto-alignment.spec.ts --project=chromium --project=webkit`. Prefix with `PRACTICE_TEST_URL=http://localhost:4178` to test production directly, including actual audio waveforms, native half-speed playback, and looping.
- Latest production measurements are written to `artifacts/auto-alignment-verification-chromium.json` and `artifacts/auto-alignment-verification-webkit.json`.
- Original two-page PDF and variable-tempo WAV fixtures with an introduction are in `tests/fixtures/alignment/`. Tests cover actual file reads, OCR, decoding, background analysis, candidate timing error, preview, manual edits, page following, persistence after reload, and rejection of unrelated audio.
- Regenerate fixtures with `node scripts/create-alignment-fixture.mjs` after starting the server on port 5189. Test recordings are original harmonic synthesis fixtures; their results do not establish accuracy for arbitrary real songs.
- If the test host's audio hardware clock malfunctions, Chromium tests optionally support `PRACTICE_SILENT_SINK=1` to route the final test output to a virtual sink. This does not change the product synchronization clock. Use of this option is recorded in test reports; WebKit has no equivalent fallback.

See [TEST_REPORT.md](TEST_REPORT.md) for detailed results and historical fixes. The test report is currently in Traditional Chinese.

## Modules

| Path | Responsibility |
| --- | --- |
| `src/music/importer.ts` | Structured-file validation, parsing, and fingering data. |
| `src/music/tab-recognition.ts`, `tab-*.ts` | Local tablature recognition, source regions, and rhythm candidates. |
| `src/music/alignment-score.ts` | Native MIDI note/repeat timeline and PDF coordinate mapping. |
| `src/music/alignment-dsp.ts`, `alignment.worker.ts` | Audio features, subsequence DTW, and quality checks. |
| `src/music/alignment.ts` | Decoding, background analysis, cancellation, and timeouts. |
| `src/music/audio.ts`, `timeline.ts` | Single playback clock, time mapping, seeking, and loops. |
| `src/components/AudioDialog.tsx` | Automatic candidates, previews, and manual timing corrections. |
| `src/components/ScoreView.tsx`, `ReferenceViewer.tsx` | Digital-score and original-PDF following. |
| `src/storage/library.ts` | Local storage and serialized save/delete operations. |

## Dependencies and licenses

Soundfonts, fonts, and OCR resources are rebuilt from pinned npm dependencies and the official Vite plugin. Generated runtime directories, `node_modules`, and user libraries are not committed. The initial `npm ci` requires network access to download dependencies.

See [THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt) and [public/licenses/](public/licenses/) for third-party licenses. alphaTab uses MPL-2.0; fft.js uses MIT; PDF.js, Tesseract.js, and SONiVOX follow their included licenses. Audiveris is downloaded separately and uses AGPL-3.0.

The demo composition and test fixtures were created for this project. No separate license has been specified for the project's original code; third-party components remain subject to their respective licenses.
