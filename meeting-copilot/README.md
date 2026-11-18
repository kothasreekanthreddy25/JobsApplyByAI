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

## Building the one-click installer (Windows)
```
npm install
npm start          # once, so the local matching model is downloaded into .models/
npm run dist       # produces dist/Meeting Copilot Setup <version>.exe (~150 MB)
```
- The installer is per-user (no admin rights), adds Desktop and Start Menu shortcuts, and ships the matching model so it works offline.
- Users add their own API keys on the first-run Settings screen; keys are stored encrypted (Windows DPAPI) in `%APPDATA%/Meeting Copilot`, never inside the installer.
- Not code-signed yet: Windows SmartScreen will warn until a signing certificate is configured. Do not commit `dist/` (too large for GitHub); upload the `.exe` to a release or your own download page.
- `npm run pack` builds only the unpacked app folder (faster, for testing).

## Licensing (selling the app)
**Free allowances, counted separately: 24 hours of Demo mode (the AI mock interview) and 1 hour of Realtime mode (real meetings).** Only time spent in a live session counts (while the app is listening), with no calendar limit. When an allowance runs out the overlay asks for a license key; one key removes both limits. Prep packs and settings are always free.

**Your side (seller):**
```
node tools/license.js init                                   # once: creates .license/private.pem and src/licensePublic.js
node tools/license.js make --email buyer@example.com --days 365   # prints a key to send to the buyer (omit --days for lifetime)
node tools/license.js verify <key>
```
- **Back up `.license/private.pem`** (password manager / encrypted drive). It is git-ignored and never shipped. If you lose it you can't issue valid keys; if you re-run `init --force` every key you already sold stops working.
- Rebuild the installer after `init` (the app embeds only the public key, so it can verify keys but never create them).
- Set `buyUrl` in `package.json` (an https link to your checkout page) to show a "Buy a license" button in Settings.
- Change the free time with `TRIAL_MINUTES` (Demo, default 1440) and `TRIAL_REALTIME_MINUTES` (Realtime, default 60), and add a calendar limit with `TRIAL_DAYS`, in the environment when testing.

**Limits (no server involved):** keys are checked offline, so a key can be shared and an expired-trial machine can be reset by wiping app data. The trial counter is stored encrypted in two places to stop casual resets. For hard enforcement, add an activation server that binds a key to one machine (and can revoke keys); keys issued today would keep working with it.

Run the tests with `npm test`.

## Modes: Realtime and Demo
Switch in Settings (top section) or from the tray menu (Mode).

- **Realtime:** waits for a real meeting (Zoom, Teams, Meet, Webex are detected automatically, or press `Ctrl+Shift+S`). Questions heard in the meeting are answered from your documents and prep pack first; if those don't cover it, the app asks OpenAI (when `OPENAI_API_KEY` is set) and falls back to Claude.
- **Demo:** schedules a mock interview (default: starts in 5 minutes, 5 questions, 40 s per question; all adjustable). At the start time a **Mock Interview Room** window opens and a notification appears. The student clicks **Admit AI interviewer**; it greets them and asks random questions taken from the documents in the `docs` folder (any PDF/Word/text/Markdown file; a question is a line ending in `?` or starting with "Tell me", "Describe", etc.; lines starting with `A:` are treated as answers). The app hears the interviewer through the computer's sound output, exactly like a real call, and the answers appear in the hidden overlay. The voice is Deepgram Aura (same key as speech recognition), with the Windows voice as a fallback. If the audio isn't picked up within 9 s, the app answers from the known question text so the demo never stalls.
- A sample question file (`docs/sample-interview-questions.md`) is created on first run so Demo works immediately.

In Demo mode the Settings window shows only the demo controls: API keys, license, prep pack, documents and hotkeys are hidden (a section reappears only if the demo cannot run without it, e.g. keys not saved yet or an expired license). Clicking **Schedule mock interview** or **Start now** closes the window; the tray tooltip shows the countdown, and a notification plus the room window appear at the start time.
