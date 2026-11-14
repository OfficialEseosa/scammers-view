"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from "livekit-client";
import type { Finding } from "@/lib/types";
import type { CallView, LiveJoin } from "@/lib/call/schema";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { ErrorState, WarnNote } from "@/design/states";
import { LABEL, POLL_MS, Transcript } from "./parts";

type Conn = "connecting" | "ringing" | "on" | "ended" | "mic-denied" | "failed";

/**
 * A live voice call inside the browser: this tab joins its own LiveKit room with a token that can
 * only publish the microphone, and the agent worker plays the scammer. The transcript and
 * scorecard come from the app server (polled), never from the room.
 */
export function LiveCall({
  call,
  join,
  findings,
  masked,
  onDone,
  onGone,
  onFallback,
}: {
  call: CallView;
  join: LiveJoin;
  findings: Finding[];
  masked: boolean;
  onDone: (c: CallView) => void;
  onGone: () => void;
  /** Microphone blocked: offer the typed, in-browser version instead. */
  onFallback: () => void;
}) {
  const [conn, setConn] = useState<Conn>("connecting");
  const [view, setView] = useState(call);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const roomRef = useRef<Room | null>(null);
  const audioHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;
    let alive = true;

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        audioHost.current?.appendChild(el);
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
      })
      .on(RoomEvent.ParticipantConnected, () => alive && setConn("on"))
      .on(RoomEvent.ParticipantDisconnected, () => {
        if (alive) setConn((c) => (c === "on" ? "ended" : c));
        room.disconnect();
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => alive && setSpeaking(speakers.some((p) => !p.isLocal)))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => alive && setNeedsTap(!room.canPlaybackAudio))
      .on(RoomEvent.Disconnected, () => alive && setConn((c) => (c === "on" || c === "ringing" ? "ended" : c)));

    (async () => {
      try {
        await room.connect(join.url, join.token);
      } catch {
        if (alive) setConn("failed");
        return;
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        room.disconnect();
        if (alive) setConn("mic-denied");
        return;
      }
      if (!alive) return;
      setConn(room.remoteParticipants.size > 0 ? "on" : "ringing");
      await room.startAudio().catch(() => {});
      setNeedsTap(!room.canPlaybackAudio);
    })();

    return () => {
      alive = false;
      room.removeAllListeners();
      void room.disconnect();
      roomRef.current = null;
    };
  }, [join.url, join.token]);

  // Transcript while talking, scorecard once the agent has graded the call.
  useEffect(() => {
    let alive = true;
    const id = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/call/${call.id}`, { cache: "no-store" });
        if (!alive) return;
        if (res.status === 404) return onGone();
        if (!res.ok) return;
        const v = (await res.json()) as CallView;
        setView(v);
        if (v.status === "ended" && v.scorecard) onDone(v);
      } catch {
        /* keep polling */
      }
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [call.id, onDone, onGone]);

  useEffect(() => {
    if (conn !== "on") return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [conn]);

  async function toggleMute() {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(muted);
    setMuted(!muted);
  }

  function hangUp() {
    void roomRef.current?.disconnect();
    setConn("ended");
  }

  if (conn === "mic-denied") {
    return (
      <Card className="flex flex-col gap-4">
        <WarnNote>Microphone access was blocked, so the live call can&apos;t hear you.</WarnNote>
        <p className="text-muted">Allow the microphone for this site and try again, or practise by typing instead.</p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onFallback}>Practise by typing</Button>
          <Button variant="ghost" onClick={onGone}>
            Back
          </Button>
        </div>
      </Card>
    );
  }
  if (conn === "failed") {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState title="Couldn't connect the call." />
        <div className="flex flex-wrap gap-3">
          <Button onClick={onFallback}>Practise by typing</Button>
          <Button variant="ghost" onClick={onGone}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-10">
      <div ref={audioHost} hidden />
      <Card className="flex min-w-0 flex-col gap-4">
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className={speaking ? "size-2 animate-pulse rounded-full bg-danger" : "size-2 rounded-full bg-edge-strong"} />
          {conn === "connecting" && "Connecting…"}
          {conn === "ringing" && "Ringing…"}
          {conn === "on" && (
            <>
              Unknown caller · {LABEL[call.scenario]} · <span className="sv-num">{clock}</span>
              {speaking && <span className="sr-only">The caller is speaking</span>}
            </>
          )}
          {conn === "ended" && "Call ended"}
        </p>
        {needsTap && conn !== "ended" && (
          <Button variant="secondary" className="w-fit" onClick={() => void roomRef.current?.startAudio().then(() => setNeedsTap(false))}>
            Tap to hear the caller
          </Button>
        )}
        <Transcript lines={view.transcript} findings={findings} masked={masked} />
        {conn === "ended" && <p className="text-muted">Scoring your call…</p>}
      </Card>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        <Button variant="destructive" size="lg" onClick={hangUp} disabled={conn === "ended"}>
          Hang up
        </Button>
        <Button variant="secondary" onClick={() => void toggleMute()} disabled={conn !== "on"} aria-pressed={muted}>
          {muted ? "Unmute" : "Mute"}
        </Button>
        <p className="text-sm text-subtle">Audio goes through LiveKit and Deepgram for this call only. Nothing is recorded.</p>
        <p className="text-sm text-subtle">Tip: a real person won&apos;t mind if you hang up and call back on a number you already have.</p>
      </aside>
    </div>
  );
}
