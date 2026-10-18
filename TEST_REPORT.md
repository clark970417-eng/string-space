# String Space: Verification Report

Latest test date: 2026-10-18. Environment: macOS, Node.js 24.18.0, npm 11.16.0, Playwright 1.64.1. Tests use the actual alphaTab 1.8.4 parser, renderer, and audio engine.

## Latest verification: complete production PDF + audio workflow (2026-10-18)

Tested the production build currently available at `http://localhost:4178/`. Application behavior is unchanged from `f2bb0a2`; this round strengthened tests and evidence without changing product code. Command:

```sh
PRACTICE_TEST_URL=http://localhost:4178 npx playwright test tests/browser/auto-alignment.spec.ts --project=chromium --project=webkit
```

**4 / 4 passed**: successful alignment and mismatch rejection in both desktop Chromium and WebKit with iPhone 13 mobile emulation. Tests uploaded a real two-page PDF and seven-second PCM WAV through file inputs, then performed actual OCR, correction, audio decoding, and background DTW analysis. No timestamps were entered manually before automatic candidates were generated. PDF notes read back from IndexedDB matched the original eight pitches. Observations used the production UI, stored data, and native HTMLAudioElement, without the development-only `__practice` interface.

| Measurement | Chromium | WebKit mobile emulation |
| --- | --- | --- |
| Automatic bar timestamps (seconds) | 0.80, 3.12, 5.76 | 0.80, 3.12, 5.76 |
| Ground-truth boundaries (seconds) | 0.80, 3.00, 5.80 | 0.80, 3.00, 5.80 |
| Maximum candidate error in this run | 0.12 seconds | 0.12 seconds |
| Actual audio RMS | 0.128018 | 0.117132 |
| Sampled progress/media-clock difference during normal playback | 0.011134 seconds | 0.007743 seconds |
| Measured native half-speed ratio | 0.499812 | 0.499542 |
| Sampled progress/media-clock difference during looping | 0.011848 seconds | 0.023913 seconds |

The successful workflow also verified:

- Saving is disabled until the user checks the confirmation box. The original PDF preview reaches page two, with at least half of the current bar region visible.
- After manually correcting the second bar to 3.04 seconds, confirmation switches to recording mode. PDF highlighting and page changes follow the actual audio time.
- Pausing stops both native media time and visible progress. Clicking the first bar seeks to the automatically identified start.
- Pitch preservation is enabled. At a 0.5× setting, native playback measures approximately 0.5 times real time using the same browser's performance.now clock.
- Bar two loops at 1.5×, including the initial seek and at least two returns, while bar state remains consistent with audio time.
- After disabling the loop and reloading, the recording pairing, automatic candidates, and manual correction remain saved. The mobile layout has no horizontal overflow.
- Unrelated audio is rejected without overwriting existing manual timestamps. No third-party upload requests occur.

**Measurement adjustments:** the initial extended test searched for the inactive loop button label after activation, when the label changes to the localized equivalent of “2–2 loop”; the selector was corrected. Connecting an additional Web Audio analyzer affected WebKit startup buffering. After RMS measurement, the test therefore re-pairs the same file through the actual UI to restore the product's native audio path before measuring speed and looping. Product playback rate and clock were unchanged. An independent native-audio half-speed control measured 0.499928. The final full production rerun passed all four tests without a virtual audio output.

Evidence: `artifacts/auto-alignment-verification-chromium.json`, `artifacts/auto-alignment-verification-webkit.json`, and corresponding screenshots. These are sampled results for controlled fixtures, not error guarantees for every recording or physical phone. PDF notes still require recognition and correction first. Actual file tests used PCM WAV; this round added no MP3/M4A file tests.

## Historical round: automatic audio/PDF alignment (2026-10-18)

| Check | Result |
| --- | --- |
| `npm test` | **46 / 46 passed**, nine test files. |
| `npm run build` | Passed; the existing large-chunk warning remains. |
| Chromium + WebKit playback/import regression | **22 / 22 passed**, including real PDF + WAV automatic alignment, mismatch rejection, and persistence in both browsers. |
| Additional preview-visibility verification | **4 / 4 passed**; an assertion requires at least 50% of the current original-score region to be visible, verifying scrolling inside the dialog. |
| Production tablature regression | **24 / 24 passed**: 19 Chromium, five WebKit. |
| `npm run test:production` | Both browsers passed audio sampling, cursor, pause, seek, speed, resource, and layout checks. |
| Clean-copy installation, tests, and build | Passed: exported only files intended for commit; public-file audit reported zero issues and zero warnings. `npm ci`, all 46 unit tests, and production build succeeded, with identical hashed output filenames. |

**Actual workflow:** uploaded `tests/fixtures/alignment/two-page-study.pdf`. Local OCR read the actual pitches `[64,67,71,66,69,65,72,70]` across two bars; tuning, rhythm, and each bar were reviewed. Uploaded seven-second PCM WAV `uneven-performance.wav`, containing a 0.8-second introduction, uneven note timing, and an ending. No alignment timestamps were entered. Automatic analysis produced three candidates, each within **0.24 seconds** of `[0.8,3,5.8]`. Confirmation remained disabled until checked. Desktop and mobile tests performed actual decoding, Web Worker analysis, and original-PDF page previews, without mocked recognition or fixed-speed timestamp generation.

After preview, the second bar was manually changed to 3.04 seconds and marked as edited. Saving activated recording mode, with original PDF regions, cursor, and page two following audio time. Display/media-clock difference was below 0.12 seconds. Reload preserved automatic results and edits. No third-party network requests occurred. An unrelated low-pitched recording was rejected without overwriting manual timestamps; incomplete data could not be confirmed.

**Acoustic method:** pinned MIT-licensed fft.js 4.0.4 computes spectra and chroma. Subsequence DTW compares the digital score's pitch contour using `(1,1)`, `(1,2)`, and `(2,1)` steps. Native MIDI expansion retains repeats, ties, and tempo data, allowing introductions, endings, and limited local tempo variation. Unit tests also cover uneven melodies, two repeat passes, chord parts, insufficient pitch variation, silence, unrelated audio, short files, and input limits. No AI service or recording upload is used. Limits are 10 minutes/100 MB, approximately 5.2 million DTW cells, cancellation, and a 120-second timeout.

**Preview and following:** recognition saves actual bar regions and page numbers derived from source-image crops. Recording mode follows the original PDF or the digital score. Older data without coordinates can follow the digital score; recognition can be repeated to obtain PDF regions. Similarity describes feature agreement, not accuracy. Low similarity, silent bars, and repeated passages prompt correction; every candidate requires user confirmation before activation.

**Fixes and failures:** the first Chromium test found that expanding analysis content reflowed the dialog and turned a click into a backdrop dismissal. Dismissal now requires both pointer-down and pointer-up outside the dialog. Another test treated `.2` and `0.2` input strings as different values; test input was normalized. Full regression found that PDF page changes briefly displayed the old image under a new page number, allowing selections on the wrong image. Rendering now waits for the matching page image; all 22 tests passed on rerun. Preview following was changed to scroll the dialog itself rather than only the background; four targeted checks passed. The fft.js license was extracted in full from its official npm README and included in the project.

**Scope:** fixtures are original clear printed PDFs and synthesized harmonic recordings, not accuracy measurements for commercial songs, human performances, or angled photographs. PDF notes must first be recognized and corrected. Manual bar regions alone cannot support pitch-based alignment, so manual timing remains available. Constant chords, transposition, vocals, dense accompaniment, extra repeats, omitted notes, and extreme tempo changes may fail or mismatch. Within-bar cursors interpolate timestamps. Conditional synthesized ties across repeat, ending, or jump boundaries remain limited. File verification used PCM WAV; MP3/M4A depend on browser decoding.

No audio tests in this round used virtual output. Neither the desktop app nor the audio service was restarted. Evidence: `artifacts/auto-alignment-chromium.png`, `artifacts/auto-alignment-webkit.png`, and `artifacts/production-smoke.json`. Reproduction instructions and research references are in README.

The following sections are historical; the current automatic alignment capabilities are described above.

## Historical round: PDF/audio synchronization, nested repeats, and manual jumps (2026-10-18)

| Check | Result in this round |
| --- | --- |
| `npm test` | **40 / 40 passed**, eight test files. |
| `npm run build` | Passed; existing large-chunk warning remains. |
| Chromium/WebKit player | **All 18 scenarios verified**: initial full run had 17 passes and one failure because preview audio did not stop immediately on save; the failing case passed after correction. |
| Production `PRACTICE_TEST_URL=http://localhost:4178 npm run test:tab` | **24 / 24 passed**: 19 Chromium, five WebKit, including new D.C. correction, persistence, and actual playback jumps. |
| `npm run test:production` | **Both Chromium and WebKit passed** audio sampling, cursor, pause, seek, speed, resource, and layout checks. |

**Real PDF/audio uploads:** uploaded the project's two-page tablature PDF `tests/fixtures/tab/cross-page-ties.pdf` and 12-second PCM WAV `tests/fixtures/test-tone.wav` through file inputs, without injecting fake import results. Marked one bar per page. The alignment screen displayed the original score; actual media seeking and the new “Mark current time and advance to next bar” control recorded the first timestamp, followed by `[1, 3, 7]` seconds. The bars deliberately lasted two and four seconds to rule out fixed-speed scrolling.

Both Chromium and mobile WebKit verified: out-of-order timestamps cannot be saved; confirmation selects recording mode; the actual uploaded audio yields RMS > 0.001 through MediaElementSource/AnalyserNode; the synthesizer remains stopped; display/media time differs by less than 0.12 seconds; variable-tempo tick mapping error is below 150 ticks; bar two opens PDF page two with its region and cursor visible; paused ticks remain stationary; clicking bar one seeks to one second; 0.5× uses preservesPitch=true; IndexedDB reload restores audio and position; and no horizontal overflow occurs. Reconfirming an edited original score clears old pairing to prevent stale mappings. Existing end-of-file loops, repeated A–B loops, speed, seek, and interruption tests still passed.

**Fixes:** added original-score comparison, bar selection, and sequential timestamp marking to the pairing screen; automatically selected audio mode after save; waited for storage writes before closing; paused preview immediately on Save; reapplied the stored position after metadata and timeline load; and suspended following after manual PDF page changes. An initial new test omitted the manual-marking entry point during re-review; both browser flows passed after fixing the test. Initial development tests reached another project occupying port 5178; switching to dedicated port 5189 verified the correct app without terminating the other project.

**Jump behavior:** two-level nested repeats, with 2–4 passes, produced native sequence `1,2,3,2,3,4,1,2,3,2,3,4`. Three levels, unclosed repeats, and combinations with endings were rejected. Added manual D.C./D.S., al Fine, Fine, and Segno correction with missing-target validation. D.C. al Fine persisted and played the actual visible sequence `1,2,3,1,2`; D.S. al Fine produced native MIDI sequence `1,2,3,4,2,3`. After D.C., the source note attacked again, while an internal tie destination emitted no additional NoteOn. Attack ticks were `0,3840,7680,11520,15360`; both source occurrences lasted 3840 ticks. This does not establish support for conditional ties across jump boundaries.

**Earlier WebKit limitation:** independent oscillator checks in this round showed advancing clocks and waveforms in both browsers; both passed production audio checks. No test set `PRACTICE_SILENT_SINK` or substituted virtual output. Neither the desktop app nor host audio service was restarted. This does not claim to have fixed the previous host state or to verify physical iPhone hardware/Bluetooth latency.

**Remaining limitations at that time:**

- PDF/image recognition required review, without guarantees for arbitrary handwriting, angled photographs, or complex published scores.
- PDF/recording timing was manual per bar, with within-bar interpolation, no automatic alignment, and no note-level tracking. Tests used original PDF/WAV fixtures, not the user's actual song files. MP3/M4A decoding was browser-dependent and not file-tested in this round.
- Conditional synthesized ties across repeats, different endings, or D.C./D.S. boundaries were unsupported. Correction removed the link and required confirmation. Original recording playback does not resynthesize or alter recorded ties.
- Nested repeats could not combine with endings; D.C./D.S. could not combine with repeats/endings. Coda, complex multiple jumps, and jump-text OCR were incomplete.

Evidence: `artifacts/production-smoke.json`, `artifacts/pdf-audio-chromium.png`, `artifacts/pdf-audio-webkit.png`. Commands: `npm test`, `npm run test:e2e`, `PRACTICE_TEST_URL=http://localhost:4178 npm run test:tab`, `npm run test:production`. Development used port 5189; production preview used 4178.

The following records are historical; the later 2026-10-18 sections above take precedence.

## Historical round: repeats and first/second endings (2026-10-15)

| Check | Final result in this round |
| --- | --- |
| `npm test` | **37 / 37 passed**, eight test files. |
| `npm run build` | Passed; existing large-chunk warning remains. |
| Production TAB Chromium | **18 / 18 passed**, using the test virtual output described below. |
| Chromium player regression | **15 / 15 passed**, using the same output setting. |
| WebKit mobile correction | **4 / 4 passed**: tuplets, dots, cross-system tie drafts, and repeat/ending correction and persistence. |
| Chromium production audio | Passed actual synthesis sampling, pause, cursor, seek, speed, resources, and layout with a virtual output sink. |
| WebKit/physical audio output | **Not verified in this round** because of abnormal host audio-clock behavior. Earlier successes were not substituted. |

PNG and PDF recognition read actual double barlines, dots, brackets, and ending numbers to produce the three-bar order `1 → 2 → 1 → 3`. Changing the pass count to three blocked confirmation for first/second endings; restoring two allowed it. Actual expanded MIDI order was `[0,1,0,2]`. The repeated source attacked at 7680 ticks; the tie destination at 8640 emitted no second NoteOn. At 160 BPM, same-frame browser observations of bar/progress/cursor showed a return to bar one at approximately three seconds; RMS > 0.00001 was measured during 3200–3600 ms, followed by the second ending. Existing tie, A–B loop, pause, speed, seek, and long-score-following regressions passed.

Unit tests also verified ordinary three-pass repeats, multi-bar first/second endings, rejection of missing second endings/nested/unclosed markings, and one attack per tied source per repeat pass with 3840-tick duration. OCR initially read the second repeat barline as fret 1; digit candidates now exclude lines crossing the staff, with a regression test. Two draft tests initially read or reloaded before asynchronous saving completed; after waiting for the save dialog to close, all 18 TAB tests passed.

**Audio environment diagnosis:** after waiting 700 ms, a standalone Chromium oscillator's AudioContext was running but currentTime remained near 0.0053 seconds; WebKit remained at zero with no output. The existing demo's production audio check also failed, so the issue was not specific to repeats. Chromium's `--disable-audio-output` allowed the same oscillator to advance to approximately 0.709 seconds with a real waveform. An optional `PRACTICE_SILENT_SINK=1` therefore replaced only the test browser's final operating-system output sink, retaining actual synthesis, AudioContext time, MIDI, and AnalyserNode. Product audio logic was unchanged; no fixed timer drove its cursor. WebKit audio was not reported as passed; only the four non-playback correction tests passed. No app or audio service restart occurred.

**Limitations at that time:** only flat repeats and consecutive first/second endings were supported, with endings restricted to two passes. Repeat count defaulted to two and could be edited to 2–4. Nested repeats, D.C./D.S./Coda, endings spanning systems, additional endings, and mixed markings were not automatically handled. Ties crossing repeat starts/ends or different ending boundaries were removed with an explicit reattack warning and full-score reconfirmation; conditional cross-ending ties were not restored. Internal ties and ties within the same ending remained. Clear printed fixtures do not establish accuracy for arbitrary sources.

Fixtures: `tests/fixtures/tab/repeat-endings.png`, `tests/fixtures/tab/repeat-endings.pdf`. Reproduction commands and official-source references were documented in README at that time.

## Historical round: cross-system and cross-page ties (2026-10-15)

| Check | Final result |
| --- | --- |
| `npm test` | **32 / 32 passed**, seven test files. |
| `npm run build` | Passed; existing large-chunk warning remains. |
| Production `PRACTICE_TEST_URL=http://localhost:4178 npm run test:tab` | **20 / 20 passed**: 16 Chromium, four mobile WebKit. |
| `npm run test:e2e` | Final complete rerun: **16 / 16 passed**. |
| `npm run test:production` | **Both browsers passed** actual audio, cursor, pause, seek, speed, resources, and layout. |

Added real two-system PNG and two-page PDF import tests, verifying source pages, cross-boundary source bars, and native tieOrigin references. Each eight-note fixture contained two ties; the actual alphaTab MIDI generator emitted only six note events. The cross-boundary source began at 2880 ticks and lasted 1920 ticks; its destination at 3840 emitted no new NoteOn. At 0.75×, same-frame browser observations during the 4100–4800 ms sustain interval required RMS > 0.00001, current bar two, and a visible cursor. Pausing returned to silence. These checks covered same-system ties, cross-system PNG, and cross-page PDF, beyond merely checking data flags.

Mobile Chromium/WebKit correction used the two-system original image, verifying no horizontal overflow, usable tie controls, draft persistence, and restoration. Changing the earlier source fret removed the incompatible later tie without overwriting the destination pitch. Negative cases—only one partial arc, or selecting PDF pages `1,3` while skipping the middle—did not automatically connect matching frets; manual correction remained possible. Pixel tests covered missing lines, straight lines, different strings, and arc direction.

Initial cross-page tests found that a fixed-pixel margin missed arc ends when PDF rendering scaled up; margins now scale with staff spacing. A new mobile test initially failed because its helper did not open the site; initialization was corrected and the full round rerun. The first player run passed 14/16: one soundfont load exceeded 12 seconds, and one speed check included communication latency in a fixed one-second wait. Tests now allow 30 seconds for resources and calculate ticks/second from simultaneous in-browser time/tick reads. Speed acceptance bounds were unchanged; all 16 passed on the final complete rerun. Neither the audio engine nor an independent cursor timer was changed to satisfy tests.

**Scope:** clear horizontal, single-column tablature in reading order. The last note of one system and first of the next require visible compatible partial arcs, the same string/pitch, and contiguous timing. Cross-page ties require consecutive selected pages. Missing ends, handwriting, angled photos, multiple columns, cross-voice ties, skipped events/pages, techniques, and similar-looking slurs need manual work. No general published-score accuracy claim is made. Guitar sustains naturally decay rather than maintaining constant volume. Recognition runs locally in the browser.

Original fixtures: `tests/fixtures/tab/cross-system-ties.png`, `tests/fixtures/tab/cross-page-ties.pdf` (pages `1-2`). Later sections above supersede historical capabilities below.

## Historical round: whole/half rests and final tie verification (2026-10-15)

| Check | Final result |
| --- | --- |
| `npm test` | **31 / 31 passed**, seven test files. |
| `npm run build` | Passed; large score-engine chunk warning remains. |
| `PRACTICE_TEST_URL=http://localhost:4178 npm run test:tab` | **19 / 19 passed**: 15 Chromium, four mobile WebKit. |
| `npm run test:e2e` | **16 / 16 passed**, complete rerun. |
| `npm run test:production` | **Both browsers passed** actual audio, silence after pause, cursor, seek, speed, resources, and layout. |

This round corrected audio-sampling timing. Previously, repeated progress queries from the test process followed by a separate audio read could miss the sustain interval because of communication latency. A browser-side observer now starts before playback and reads RMS, progress, bar, and cursor in the same animation frame. Tests still strictly require the 4100–4800 ms interval at 0.75×, without extending into the next attack; the cross-bar tie spans 3000–5000 ms. Both PNG and PDF tests measured RMS > 0.00001, showed bar two and a visible cursor, then returned to silence after pause. The observer is test-only and does not control product playback or following.

Actual alphaTab MIDI generation independently verified that a three-note cross-bar tie chain produces **one NoteOn with total duration 5760 ticks**. Simultaneous untied chord notes still attack separately. Tests cover matching strings/pitches, fret edits, source deletion, preceding rests, underfilled previous bars, and invalid-tie cleanup, preventing incorrect links or overwritten user pitches.

Whole/half rests are distinguished by supporting lines and the block's vertical position. Floating blocks and the bottom of a time-signature 4 are rejected. Real PNG/PDF import and correction passed. Full-bar rests follow 3/4 and 6/8 meters; half rests last two quarter-note beats. Mobile correction, source-bar hints, draft reload, and removal of incompatible ties after edits passed.

No code or service was changed/restarted during the final test run. These are complete final results for a fixed version, rather than isolated reruns presented as a full run.

**Limitations at that time:** automatic ties were limited to adjacent same-string/same-pitch notes within one system, including across bars. Cross-system/page ties required manual correction. Guitar audio naturally decays. Clear printed fixtures do not measure publisher, handwriting, or angled-photo accuracy; recognition still requires confirmation. No external image service was added.

Reproducible fixtures: `tests/fixtures/tab/tied-study.png`, `tests/fixtures/tab/tied-study.pdf`, `tests/fixtures/tab/whole-half-rests.pdf`. Upload, select Guitar tablature, recognize, correct, confirm, then play synthesized audio. Later rounds above supersede these historical limitations.

## Historical round: tablature rhythm recognition (2026-10-15)

| Check | Final result in this round |
| --- | --- |
| `npm test` | **23 / 23 passed**, including exclusion of repeat dots, explicit tuplet brackets/event counts, actual synthesized durations, and pause/seek races. |
| `npm run build` | Passed; large score-engine chunk warning remains. |
| Production `PRACTICE_TEST_URL=http://localhost:4178 npm run test:tab` | **15 / 15 passed**: 12 Chromium, three mobile WebKit. |
| `npm run test:e2e` | Final complete rerun: **16 / 16 passed**. |
| `npm run test:production` | Both browsers passed actual audio output, silence after pause, cursor, seek, speed, and layout. |

New image workflows read single dots and eighth/quarter rests from PNG and PDF, double dots and sixteenth rests from source images, and quarter-to-thirty-second rests including dotted rests from rest-only scores. Bracketed triplets/quintuplets/sextuplets applied only to their entire group, without affecting the next event. After editing dots/rest durations, the correct saved score yielded alphaTab durations `[1680, 240, 960, 960]` ticks, totaling four beats. Triplets measured 640 ticks and quintuplets 384 ticks. Rests contained no note data; the whole-bar timeline lasted three seconds at 80 BPM.

Failure coverage: unavailable rhythm fonts stop recognition and offer manual entry without a false completed result. Existing cancellation, corrupt-image, missing digit-resource, draft, two-digit fret, actual renderer-export, and multi-page PDF regressions passed.

The initial playback regression passed 15/16. Investigation found that alphaTab's asynchronous pause response could move the cursor to an old beat, overwriting an immediate seek. The fix retains the latest seek and submits it to the same audio engine after pause processing. A reproducible unit test and complete 16-case regression verified the fix; no independent timer drives the cursor.

**Limitations at that time:** symbol fixtures were clear printed scores synthesized with Bravura, not publisher/handwriting/angled-photo accuracy studies. Whole/half rests, unbracketed or mixed-duration/nested tuplets, and ties required manual correction. No external recognition service or automatic-correction claim was made.

Fixtures: `tests/fixtures/tab/rhythm-study.png` and `tests/fixtures/tab/rhythm-study.pdf`, an original four-beat bar with a dotted quarter note, eighth rest, quarter rest, and quarter note. Upload and select Guitar tablature to recognize it.

The remaining sections preserve earlier test history. Later results above take precedence.

## Historical baseline results

| Check | Result |
| --- | --- |
| Strict TypeScript checking and Vite production build | Passed; generated `dist/`. |
| Vitest data, pitch, rhythm, repeats, alignment, and storage | **13 / 13 passed**. |
| Playwright complete workflows | Full run: **14 / 16 passed**; targeted reruns of loop and count-in/progress-seek cases: **2 / 2 passed**. Fifteen Chromium cases and one mobile WebKit case. |
| Production smoke tests | **Both browsers passed**, measuring actual nonzero audio output. |
| Final library/corrupt-file regressions | Passed, including immediate reload after deletion, demo reload, and a truncated JPG with a valid header. |
| npm audit | Zero known vulnerabilities in the package database at execution time; not a comprehensive security audit. |
| Production network requests | Both engines recorded zero third-party requests, zero HTTP errors, and zero unhandled page exceptions. |

Vite still warns that the score engine and worker exceed the default 500 kB chunk threshold. This is not a build error. Initial load cost remains relevant; no slow-network benchmark has been performed.

## Original ten acceptance scenarios

| Scenario | Actual verification and result |
| --- | --- |
| 1. Play the demo on first visit | Fresh storage loads the original 16-bar composition. Clicking Play produces actual AudioNode RMS > 0.001. |
| 2. Imports display actual file content | XML and MXL both yield four bars, 120 BPM, and first-bar MIDI pitches `[64, 67, rest, 59]`, matching the source without demo substitution. Pitch-only XML displays system-suggested fingering while retaining pitches. |
| 3. Audio position matches score highlighting | Playback snapshots come directly from alphaSynth position events. Bars match actual ticks and the cursor updates through the same API. Production also verifies time, cursor, bar seeking, and audio output. |
| 4. Pause stops audio and cursor together | Tick and cursor style stay unchanged; RMS falls below 0.001. |
| 5. Clicking a bar seeks both | Clicking bar three reaches bar three/tick 7680. Timeline seeking and return-to-start are tested. Recording mode maps bar three to the manually assigned five seconds. |
| 6. Speed changes remain synchronized | A 120 BPM score at 0.5× displays 60 BPM; its audio clock advances approximately 960 ticks/second. Changes during playback retain consistent speed, position, and bar. The synthesizer changes playback rate, not MIDI pitches. |
| 7. Repeated A–B loops avoid drift/extra attacks | A single-bar loop at 120 BPM plays for approximately 10.2 seconds, with at least four returns. Periods are 2,000 ±150 ms; each full cycle's NoteOn order is exactly `[64, 67, 59]`, without extra notes. |
| 8. Portrait mobile readability and controls | Chromium/WebKit iPhone 13 emulation at 390×664 reflows by bar. Play targets are at least 44 px; no page-wide horizontal overflow. At 844×390 landscape, the final bar can scroll above the controls. |
| 9. Long-score following | A real 48-bar MusicXML fixture scrolls automatically after seeking to bar 20 and playing. Manual wheel browsing suspends following until the return control is pressed. |
| 10. Honest failure/incomplete-data states | Unmarked PDFs disable playback and offer bar marking. Marked PNGs create only a rest timeline and beat guidance. Unsupported GP5, corrupt XML, invalid/truncated JPG, interrupted soundfont loading, and unavailable storage all show actionable next steps. |

## Additional baseline verification

- MusicXML rests, fingering, 4/4, and total duration; actual repeated bar order `[1, 2, 1, 2, 3, 4]`.
- Four-bar tempo-change durations `[2, 2, 4, 4]` seconds, ruling out fixed-speed scrolling.
- Chord accompaniment creates actual notes from selected beats/patterns and explicitly does not represent the original arrangement.
- Incomplete, reversed, or out-of-range manual timestamps cannot be saved. Confirmed recording mode follows `HTMLAudioElement.currentTime` while the synthesizer stays stopped, avoiding doubled audio.
- A loop whose B endpoint equals the 12-second file ending continues through at least two returns to A. A real media ended event recovers looping; pause stops position changes.
- Closing the alignment dialog after saving stops its native preview audio to avoid overlap with practice playback. The corresponding workflow and production tests passed after the final change.
- Score ticks do not advance during the one-bar count-in; playback starts afterward.
- Simulated window blur pauses audio/cursor together and offers a resume prompt.
- Search, rename, delete, clear library, reload demo, and persistence of speed/last position.
- Serialized autosave/delete operations prevent older writes from reviving deleted scores.
- Original JPG/PNG/PDF previews and local persistence; production also verifies PDF worker, SoundFont, and font resources.
- Reviewed actual desktop/mobile focused-mode screenshots and fixed cursor layering over controls.

## Reproduction

```sh
npm ci
npx playwright install chromium webkit
npm test
npm run test:e2e
npm run build
```

For production, start `npm run preview -- --port 4178` in another terminal, then run:

```sh
npm run test:production
```

This command uses local port 4178 and reads PDF fixtures generated by browser tests; run `npm run test:e2e` first. Set `PRACTICE_PREVIEW_URL` to use another URL.

## Evidence files

- [Production desktop screenshot](artifacts/production-chromium.png)
- [Production WebKit mobile focused mode](artifacts/production-webkit.png)
- [Mobile normal mode](artifacts/mobile.png)
- [PDF preview](artifacts/pdf-preview.png)
- [Machine-readable production results](artifacts/production-smoke.json)
- `tests/music.test.ts`, `tests/storage.test.ts`, and `tests/browser/`: rerunnable test sources.

## Baseline test boundaries

These tests measure actual browser audio samples, MIDI events, and playback state. They are **not subjective listening evaluations** and do not measure speaker or Bluetooth output latency. Mobile tests use browser emulation, not physical iPhones, iPads, or Android devices.

Only PCM WAV received complete pairing tests. MP3/M4A playback depends on browser and codec. Loop stability was measured for approximately ten seconds and does not establish long-running background reliability on every device; the app pauses when leaving the page.

At this historical stage, local Audiveris OMR and per-note correction had been added, but automatic recording alignment had not. Recognition supported printed standard notation, not pure tablature/handwriting, and depended on photo quality. MusicXML verification covers listed features and fixtures, not the entire specification, every Guitar Pro format, or arbitrary publisher-specific techniques. See README for current limitations.

## Historical image/PDF recognition acceptance

- Actual Audiveris 5.11.0 runs exported MusicXML from PNG, PDF, and JPG. Correction displayed recognized notes without mocked APIs or preset melodies.
- The original four-bar image was initially misread as 6/4 instead of 4/4, with missing notes. Tests verified recognized E4/G4, manually corrected the meter and missing notes, and confirmed a final pitch sequence matching the source exactly.
- Per-bar confirmation, beat validation, draft save/reload, confirmed synthesis, and cursor synchronization passed.
- Selected PDF pages and high-resolution JPG recognition passed. A low-resolution JPG failed; the UI honestly suggested higher resolution/manual entry without demo substitution.
- At 390 px, correction had no page-wide horizontal overflow. If the local service was unavailable, manual entry could still produce a confirmed playable score.
- The service rejected forged formats and ranges exceeding eight pages. Actual recognition could be canceled, after which new jobs were accepted.
- `npm run test:omr`: **4 / 4 passed** on development and production builds. Start `npm run omr` first.
- Added `tests/review.test.ts` for confirmation state, rhythm validation, pitch edits, dotted rhythms/tuplets, and pickup bars.
- Initial concurrent tests stalled and conflicted over output directories; these were not counted as passes. Sequential runs with idle sleep prevented were reverified. An initial low-resolution JPG fixture failed; a clear original was used for the successful test, retaining the failure limitation.

Evidence: `artifacts/recognized-playback.png`, `artifacts/mobile-recognition.png`; original fixtures: `tests/fixtures/omr/`. These original fixtures are not statistical recognition-accuracy studies. Multi-page limits have input-validation coverage; actual OMR examples in this round were single-page, without claims that arbitrary complex eight-page scores were verified.

Regression still showed intermittent timing/seek assertion failures at a bar boundary after loop pause and during immediate timeline seeking after pause. Both targeted reruns passed without code changes. This did not establish elimination of timing-boundary issues on all devices; original assertions and tolerances were retained.

Production testing also found an immediate-reload-after-draft-save write race. Import/correction dialogs now wait for IndexedDB writes and the current-score record before closing. Tests reload immediately after closure to verify restoration.

Final production verification: `PRACTICE_TEST_URL=http://localhost:4178 npm run test:omr` **4/4 passed**. `npm run test:production` passed in Chromium/WebKit with actual nonzero audio, silence after pause, zero third-party requests, zero HTTP errors, and zero page exceptions.

## Historical tablature recognition acceptance (2026-10-15)

Used actual Tesseract.js 6.0.1 OCR without a fake recognition API. Original fixtures are in `tests/fixtures/tab/`, reproducible with `scripts/create-tab-fixture.mjs`. Tests also used tablature screenshots exported by the actual alphaTab renderer.

- PNG recognition of string 1/fret 0, string 2/fret 3, string 3/fret 12, and string 6/fret 10; string/fret edits, actual MIDI pitches with capo 2, rhythm-confirmation invalidation, draft reload, audio RMS, cursor, and 0.5× speed.
- JPG and actual two-page PDF imports (pages 1–2), checking page-two provenance and two-digit frets.
- Vertically aligned digits grouped as simultaneous notes on different strings; visible beams generated eighth-note candidates. Beat validation passed only after changing the meter to 3/4.
- Recognition after cancellation, 390 px mobile correction, blank-image failure, and manual fallback when OCR resources failed to load.
- Mobile WebKit revealed that saving image Blobs directly to IndexedDB failed. Storage now uses bytes and reconstructs Blobs on read; the same draft save/restore flow was reverified.
- Actual renderer output revealed stems/cursors outside the string area being mistaken for barlines; detection was corrected. Source screenshots exclude player controls and cursor to avoid treating obscured notation as a complete score.
- Narrow digit “1” was initially filtered out. Adjusted filtering passed simultaneous-note tests. Digits touching stems may still be misread; `touching-stem.png` remains a known-limit fixture, without general photo-accuracy claims.

Unit tests added six-line geometry, barlines, visible stems/beams, PDF page numbers, separate rhythm/tuning confirmation gates, conflicting notes on the same string/beat, and original-file byte storage/restoration. Existing standard-notation recognition and audio workflows retained their engines.

New browser command: `npm run test:tab`. Evidence: `artifacts/tab-playback.png`, `artifacts/tab-mobile-review.png`. Mobile tests use Playwright WebKit/Chromium emulation, not physical devices. Unmarked TAB spacing is not treated as rhythm. At this stage, unsupported techniques, flags, rests, and complex repeats required manual entry or MusicXML.

Final regression record for that round:

- **18/18 unit tests passed**.
- One sequential 28-scenario browser run passed 26. The manual PNG-marking test read the old engine before asynchronous saving completed; it now waits for the import dialog to close. The progress slider also had only a 3 px hit area, expanded to 44 px. The two corresponding cases plus portrait/landscape mobile layout passed **3/3 targeted tests**, without relaxed audio timing tolerances.
- Existing A–B loops, long-score following, recording alignment/end-of-file looping, library, MusicXML, actual standard-notation OMR, and WebKit playback passed.
- Tablature browser coverage comprised seven Chromium cases and one mobile WebKit case, eight total. Every recognition test used actual sources/OCR; only missing-resource cases deliberately interrupted requests to verify error handling.

Final production verification: `PRACTICE_TEST_URL=http://localhost:4178 npm run test:tab` **8/8 passed**. `npm run test:production` passed actual audio, pause, seek, speed, and layout checks in both browsers.
