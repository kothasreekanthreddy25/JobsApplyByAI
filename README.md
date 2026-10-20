# Job Apply Agent

Next.js dashboard + Playwright agent that searches Naukri, LinkedIn (Easy Apply) and Monster (foundit.in),
scores each job against your resume, applies to good matches, and logs everything.

## Start

```bash
npm install     # also creates .env and downloads the browser automatically
npm run dev     # open http://localhost:3000 (first visit shows the setup form)
```

The **Setup** form asks for: resume, portal usernames/passwords (stored locally, password encrypted), and a daily-run checkbox with time.

## Dashboard
Date, job title/company, portal, skills (green = you have it), match %, status, and the full JD on click.

## Match %
70% share of the JD's skills you have, 20% job-title vs target roles, 10% experience fit (`lib/match.ts`).

## Caveats
- Automated applying likely violates these sites' Terms of Service; accounts can be restricted or banned.
- Portal HTML changes often; selectors in `agent/portals/*.ts` are best-effort.
- Extra questions, external sites and CAPTCHAs are marked **Needs manual apply**.
