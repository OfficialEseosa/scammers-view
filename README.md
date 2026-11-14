# scammers-view
See your public footprint the way a scammer would, then fix it. Self-scan only.

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
2. OAuth consent screen → Data access (scopes) → add `https://www.googleapis.com/auth/gmail.readonly`.
3. OAuth consent screen → Audience → keep the app in **Testing** and add yourself and teammates
   as **test users** (up to 100). Opening it to everyone needs Google's verification for Gmail
   access, which takes weeks.
4. Credentials → your OAuth client → Authorized redirect URIs → add
   `http://localhost:3000/api/gmail/callback`, and `https://<public-url>/api/gmail/callback` for
   any public URL you use (set `AUTH_URL=https://<public-url>` in `.env` there).
5. Restart `npm run dev`, sign in, and press **Check my Gmail** on `/check` or in the scan
   results. Afterwards, [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
   should no longer list Gmail access for the app.
