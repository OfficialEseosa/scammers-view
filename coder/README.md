# Coder workspace

One workspace runs Scammer's View: the Next app on port 3000 (the **Scammer's View** app button).

## Push the template

```sh
coder templates push scammers-view -d coder/template \
  --variable gemini_api_key=... \
  --variable elevenlabs_api_key=... \
  --variable google_client_id=... --variable google_client_secret=...
```

Every variable is optional. Without a key the matching feature falls back or hides. `AUTH_SECRET` is generated per workspace.

The template uses the Docker provider, so the Coder server (or its provisioner) needs access to a Docker daemon.

## Testing on a phone

To test on an Android phone, open the Coder HTTPS link for the web app. The microphone only works over HTTPS or on localhost, so a plain `http://<laptop-ip>:3000` link won't let the live call hear you.

Google sign-in also needs the workspace URL added as an authorised redirect URI (`https://<url>/api/auth/callback/google`).

## Logs

- Next: `/tmp/next.log`
- Agent worker: `/tmp/agent.log` (no transcripts or audio are ever logged)
