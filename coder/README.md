# Coder workspace

One workspace runs everything for Scammer's View:

- the Next app on port 3000 (the **Scammer's View** app button)
- a Typesense container, indexed on every start with `npm run index:typesense`
- the `agent/` LiveKit worker for live practice calls (only started when the LiveKit and Deepgram variables are set)

## Push the template

```sh
coder templates push scammers-view -d coder/template \
  --variable gemini_api_key=... \
  --variable elevenlabs_api_key=... \
  --variable google_client_id=... --variable google_client_secret=... \
  --variable livekit_url=wss://... --variable livekit_api_key=... --variable livekit_api_secret=... \
  --variable deepgram_api_key=...
```

Every variable is optional. Without a key the matching feature falls back or hides: no Typesense means local search; no LiveKit or Deepgram keys means the Call tab offers the turn-by-turn browser call only. `AUTH_SECRET`, the Typesense key and `CALL_AGENT_SECRET` are generated per workspace.

The template uses the Docker provider, so the Coder server (or its provisioner) needs access to a Docker daemon.

## Testing on a phone

To test on an Android phone, open the Coder HTTPS link for the web app. The microphone only works over HTTPS or on localhost, so a plain `http://<laptop-ip>:3000` link won't let the live call hear you.

Google sign-in also needs the workspace URL added as an authorised redirect URI (`https://<url>/api/auth/callback/google`).

## Logs

- Next: `/tmp/next.log`
- Agent worker: `/tmp/agent.log` (no transcripts or audio are ever logged)
