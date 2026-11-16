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
