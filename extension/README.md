# Scammer's View Chrome extension

Check a suspicious message from any page, without opening the app:

- **Right-click** selected text or a link and choose "Check with Scammer's View". The result opens in the side panel, with a link to the full report (and a practice call) in the app.
- **Side panel**: paste any message and check it.
- **Gmail banner (opt-in)**: a small warning above an open email that shows scam warning signs. It stays off, with no access to Gmail at all, until you turn it on in the popup.

Messages go to the app's `/api/check`, which compares them with known scams and never stores or logs them. The extension keeps the last result only for the browser session.

## Try it locally

1. Start the app: `npm run dev` in the project root (it serves `http://localhost:3000`).
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick this `extension/` folder.
3. Select some text on any page, right-click, and choose **Check with Scammer's View**.
4. Optional: click the extension's icon, tick **Warn me in Gmail**, allow access, then reload Gmail and open an email.

After editing extension files, click the reload icon on the extension's card in `chrome://extensions`.

## Point it at another address

The extension talks to `http://localhost:3000` by default. To use a deployed app, open the popup, enter its `https://` address under **App address**, and save (Chrome asks for permission to reach that site). Before publishing, set `DEFAULT_APP_URL` in `shared.js` to the deployed address.

## Publish

Zip the contents of this folder and upload it in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5 developer fee, then review). The store listing needs a privacy note: the extension sends only text the user chooses to check (or, if they turn it on, the open Gmail email) to the app, which does not store it.
