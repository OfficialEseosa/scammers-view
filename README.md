# scammers-view
See your public footprint the way a scammer would, then fix it. Self-scan only.

## CI and unit tests

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request to `main`:

```bash
npm ci
npm run lint
npm run typecheck
npm test          # all src/lib/**/*.test.ts and *.test.mjs (no API keys needed)
```

Or locally: `npm run ci`. Individual suites: `npm run test:cleanup`, `npm run test:gmail`, and so on.

## Cleanup agent

After a scan, each fix can offer **Clean this up for me**:

- **Data brokers** (Spokeo, Whitepages, …): an AI agent fills the opt-out form in your Chrome (or in a server browser). It asks before every submit, hands over for robot checks, and can optionally open confirmation links from your Gmail.
- **Your accounts** (Instagram, LinkedIn, GitHub, …): the Chrome extension opens the settings page you're already signed into, points at the switch, and waits for **Do it**. GitHub turns on both email-privacy checkboxes; you still set `git config` locally with your noreply address. A personal access token remains an optional fallback for visibility only.
- **2FA / security questions**: prepares a strong answer and opens the page; you make the change.

It never stores passwords. What it did is kept in memory for the day (and the extension can remind you monthly to re-check brokers). Reload the unpacked extension from `extension/` after pulling so the agent permissions are current. Optional: set `CLEANUP_CHROME_PATH` if the server browser can't find Chrome; set `CLEANUP_SERVER_BROWSER=off` to disable it.

## Automatic scam checks

### Reported links and numbers

Every checked message (paste, share menu, Chrome extension, Gmail) has its links and phone
numbers looked up in public scam reports.

- **Phone numbers** work out of the box. The server downloads the FTC's public Do Not Call
  complaint files for the last 10 days (about 1 MB a day) and matches numbers locally.
- **Links** need a free Google Safe Browsing key:
  1. In [Google Cloud Console](https://console.cloud.google.com/), open the project used for sign-in.
  2. APIs & Services → Library → enable **Safe Browsing API**.
  3. APIs & Services → Credentials → Create credentials → API key. Restrict it to the Safe Browsing API.
  4. Put it in `.env` as `SAFE_BROWSING_API_KEY=`.

### Check my Gmail

A signed-in student can let the app read their last 25 inbox and 25 spam emails once, read-only.
The app checks them, revokes the access straight away and keeps only the verdicts in memory for
10 minutes (deleted the first time the results page loads them). It uses the same Google OAuth
client as sign-in. In the Google Cloud project:

1. APIs & Services → Library → enable **Gmail API**.
2. OAuth consent screen → Data access (scopes) → add `https://www.googleapis.com/auth/gmail.readonly`
   and `https://www.googleapis.com/auth/gmail.send` (send is only used when a student starts cleanup
   and approves a removal email).
3. OAuth consent screen → Audience → keep the app in **Testing** and add yourself and teammates
   as **test users** (up to 100). Opening it to everyone needs Google's verification for Gmail
   access, which takes weeks.
4. Credentials → your OAuth client → Authorized redirect URIs → add
   `http://localhost:3000/api/gmail/callback`, and `https://<public-url>/api/gmail/callback` for
   any public URL you use (set `AUTH_URL=https://<public-url>` in `.env` there).
5. Restart `npm run dev`, sign in, and press **Check my Gmail** on `/check` or in the scan
   results. Afterwards, [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
   should no longer list Gmail access for the app.

## Real scam cases

After a scan, the app shows published scam reports that fit what is public about you:

- **Attack map**: each way in is paired with the closest real case.
- **Fix list**: a count of reported scams that fit you drops as fixes remove the facts they rely on.
- **Practice attacks**: the message is modelled on a real case of the same scam and links to it.

293 cases are indexed: 97 FBI IC3 announcements (2018 to 2026) and 196 FTC consumer alerts
(2021 to 2026). Each is tagged with the kind of scam, how it reaches you and the public facts it
relies on. A search keeps only the cases whose facts are all public for this person, then ranks
them by meaning against the attack chain. Only these reference documents are indexed; scan
findings are used as the query and are not stored.

- Source text and tags: `data/scam-cases/`. The tags were assigned by hand from each title and
  opening paragraph.
- Rebuild the list the app loads: `npx tsx scripts/build-scam-cases.ts`.
- Load it into Typesense: `npm run index:typesense -- --cases` (needs `TYPESENSE_HOST` and
  `TYPESENSE_API_KEY`). Without Typesense the app uses a built-in matcher over the same cases.

### Credits for this feature

| What | Source | Terms |
|---|---|---|
| FBI scam announcements | [FBI Internet Crime Complaint Center, Public Service Announcements](https://www.ic3.gov/PSA) | US Government publication |
| FTC consumer alerts | Source: United States Federal Trade Commission, [consumer.ftc.gov](https://consumer.ftc.gov/consumer-alerts) | US Government work, public domain, attribution requested |
| Copies of the FTC alerts | [Internet Archive Wayback Machine](https://web.archive.org/) | Used to retrieve the public FTC pages |
| Search engine | [Typesense](https://typesense.org/) (Typesense Cloud) | GPL-3.0 |
| Embedding model | `all-MiniLM-L12-v2` (sentence-transformers), run inside Typesense | Apache-2.0 |

The FTC and FBI do not endorse this project. The tagging, the matching rules and the plain
descriptions of each scam type in `data/scam-cases/scam-types.json` are our own work.
