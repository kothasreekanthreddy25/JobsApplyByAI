# Meeting Copilot

Private, capture-protected overlay that listens to a meeting and answers other participants' questions from your documents.

## Pipeline and latency budget (target 2-3 s from end of question to first visible words)

| Stage | Tech | Typical |
|---|---|---|
| Meeting detection | window-title scan every 4 s + ICS calendar | before the meeting |
| Audio | Electron system-audio loopback (other people's voices only, not your mic) | ~130 ms chunks |
| Speech-to-text | Deepgram nova-3 streaming | ~350 ms endpointing |
| Question detection | local heuristic (no LLM call) | <1 ms |
| Retrieval | in-memory BM25 over your docs | ~1 ms |
| Answer | Claude Haiku, streamed token by token | ~0.5-1 s to first token |

Network speed decides the real number; the overlay prints the measured "first token" time on every answer.

## Setup
```
cd meeting-copilot
npm install
copy .env.example .env     # add ANTHROPIC_API_KEY and DEEPGRAM_API_KEY
npm start
```

## Documents
- `docs/*.pdf|docx|md|txt|csv|json` - always loaded.
- `docs/<keyword>/...` - loaded only when `<keyword>` appears in the meeting title (e.g. `docs/acme/` for "Acme renewal call").

## Hotkeys
- `Ctrl+Shift+H` show/hide overlay
- `Ctrl+Shift+M` unlock/lock: unlocked shows a drag bar and a resize corner (layout is remembered between runs)
- `Ctrl+Alt+Arrows` move overlay; `Ctrl+Alt+Shift+Arrows` resize it (work while locked)
- `Ctrl+Alt+[` and `Ctrl+Alt+]` background transparency; `Ctrl+Alt+-` and `Ctrl+Alt+=` font size; `Ctrl+Alt+0` reset
- `Ctrl+Shift+V` spoken answers on/off (read aloud sentence by sentence; listening is paused while it speaks)
- `Ctrl+Shift+S` manually start/stop a session
- `Ctrl+Shift+Q` quit

## How the overlay stays hidden
`BrowserWindow.setContentProtection(true)` sets `WDA_EXCLUDEFROMCAPTURE` on Windows (Windows 10 2004+), so Zoom/Teams/Meet screen share and recordings show nothing there. It is also `skipTaskbar`, non-focusable and click-through, so it doesn't steal focus or appear in the taskbar. Caveats: a physical camera pointed at your screen, or capture software running at driver level, can still see it.

## Responsible use
Transcribing other people's audio is regulated in many places (one-party vs all-party consent), and many employers, interviewers and exam bodies prohibit undisclosed assistance. Use it where you have the right to, and check your meeting's rules.

## Known MVP limits
Recurring calendar events aren't expanded; scanned (image-only) PDFs are not read, no OCR; one speaker stream (no diarization); Windows-first detection.

## Prep pack: answers from your resume and the job description (mock interviews)
Generate once (needs internet + `ANTHROPIC_API_KEY`):
```
npm run prep -- --resume path/to/resume.pdf --jd path/to/job-description.txt --name acme-backend
```
This writes `prep/acme-backend.json` (used by the app) and `prep/acme-backend.md` (a study sheet you can read). It holds ~35 likely questions, each with 4 phrasings and an answer built only from your resume. `prep/` is git-ignored because it contains your personal details. See `examples/` for a sample resume, job description and generated pack (`PREP_DIR=./examples npm start` to try it).

How the live app uses it, per question:
1. **Close paraphrase of a prepared question (>= 85% meaning match):** the prepared answer appears instantly (about 2-50 ms), no AI call. The overlay shows "prepared · 91% match".
2. **Related (50-85%):** the AI answers using your top 3 prepared answers plus your resume as notes (about 0.7 s).
3. **Unrelated:** normal flow (your documents, then AI).

Matching is by meaning, not exact words or grammar, using a small local model (~25 MB, downloaded on first run to `.models/`, then offline). Tune with `PREP_HIGH` / `PREP_MID` in `.env`.
