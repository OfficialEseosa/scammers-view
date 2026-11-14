import type { TurnDirection } from "./types";

/**
 * Head-turn challenge as a pure state machine (no camera, no DOM), so the
 * component only feeds it yaw samples. Fails closed: any timeout, wrong
 * turn or lost face ends in "failed"; only a full pass yields "passed".
 */

export const TURN_TARGET_DEG = 28;
export const CENTER_DEG = 10;
const MID_LOW_DEG = 8;
const WRONG_WAY_DEG = 15;

const CENTER_HOLD_MS = 700;
const TURN_HOLD_MS = 150;
const RETURN_HOLD_MS = 300;
const WRONG_WAY_MS = 400;
const FACE_LOST_MS = 1200;

export const CENTER_TIMEOUT_MS = 12_000;
export const TURN_TIMEOUT_MS = 8_000;
export const RETURN_TIMEOUT_MS = 6_000;

export type ChallengePhase = "center" | "turn" | "return" | "passed" | "failed";
export type CaptureKind = "front" | TurnDirection;

export interface ChallengeSample {
  now: number;
  /** null when there is no usable single face this frame. */
  yaw: number | null;
}

export interface ChallengeUpdate {
  capture?: CaptureKind;
  /** Set once, when the challenge fails. */
  failure?: string;
}

export function randomOrder(): [TurnDirection, TurnDirection] {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  return buf[0] & 1 ? ["left", "right"] : ["right", "left"];
}

export class HeadTurnChallenge {
  readonly order: [TurnDirection, TurnDirection];
  phase: ChallengePhase = "center";
  step = 0;
  phaseStartedAt: number;
  failure: string | null = null;
  /** 0..1 progress of the current turn toward the target. */
  turnProgress = 0;

  private holdSince: number | null = null;
  private wrongSince: number | null = null;
  private lostSince: number | null = null;
  private midFrames = 0;

  constructor(now: number, order: [TurnDirection, TurnDirection] = randomOrder()) {
    this.order = order;
    this.phaseStartedAt = now;
  }

  get direction(): TurnDirection {
    return this.order[Math.min(this.step, 1)];
  }

  get done() {
    return this.phase === "passed" || this.phase === "failed";
  }

  timeLeftMs(now: number): number {
    const limit =
      this.phase === "center" ? CENTER_TIMEOUT_MS : this.phase === "turn" ? TURN_TIMEOUT_MS : RETURN_TIMEOUT_MS;
    return Math.max(0, limit - (now - this.phaseStartedAt));
  }

  private enter(phase: ChallengePhase, now: number) {
    this.phase = phase;
    this.phaseStartedAt = now;
    this.holdSince = null;
    this.wrongSince = null;
    this.midFrames = 0;
    this.turnProgress = phase === "return" ? 1 : 0;
  }

  private fail(reason: string): ChallengeUpdate {
    this.phase = "failed";
    this.failure = reason;
    return { failure: reason };
  }

  update({ now, yaw }: ChallengeSample): ChallengeUpdate {
    if (this.done) return {};

    if (this.timeLeftMs(now) <= 0) {
      if (this.phase === "center") return this.fail("We couldn't get a steady, front-on view of your face.");
      if (this.phase === "turn") return this.fail(`Time ran out before you turned ${this.direction}.`);
      return this.fail("Time ran out before you looked back at the camera.");
    }

    if (yaw === null) {
      this.holdSince = null;
      if (this.phase !== "center") {
        this.lostSince ??= now;
        if (now - this.lostSince > FACE_LOST_MS) return this.fail("Your face left the frame during the scan.");
      }
      return {};
    }
    this.lostSince = null;

    if (this.phase === "center") {
      if (Math.abs(yaw) < CENTER_DEG) {
        this.holdSince ??= now;
        if (now - this.holdSince >= CENTER_HOLD_MS) {
          this.enter("turn", now);
          return { capture: "front" };
        }
      } else {
        this.holdSince = null;
      }
      return {};
    }

    const sign = this.direction === "left" ? 1 : -1;
    const toward = sign * yaw; // degrees in the requested direction

    if (this.phase === "turn") {
      this.turnProgress = Math.max(0, Math.min(1, toward / TURN_TARGET_DEG));
      if (toward <= -WRONG_WAY_DEG) {
        this.wrongSince ??= now;
        if (now - this.wrongSince > WRONG_WAY_MS) {
          return this.fail(`That was the other way. The scan asked you to turn ${this.direction}.`);
        }
      } else {
        this.wrongSince = null;
      }
      if (toward >= MID_LOW_DEG && toward < TURN_TARGET_DEG) this.midFrames++;
      if (toward >= TURN_TARGET_DEG) {
        this.holdSince ??= now;
        if (now - this.holdSince >= TURN_HOLD_MS) {
          // A real head passes through the middle angles; a cut between two
          // still photos does not.
          if (this.midFrames < 1) return this.fail("Turn your head smoothly rather than jumping.");
          const capture = this.direction;
          this.enter("return", now);
          return { capture };
        }
      } else {
        this.holdSince = null;
      }
      return {};
    }

    // return to centre
    this.turnProgress = Math.max(0, Math.min(1, toward / TURN_TARGET_DEG));
    if (toward >= MID_LOW_DEG && toward < TURN_TARGET_DEG - 4) this.midFrames++;
    if (Math.abs(yaw) < CENTER_DEG) {
      this.holdSince ??= now;
      if (now - this.holdSince >= RETURN_HOLD_MS) {
        if (this.midFrames < 1) return this.fail("Turn back smoothly rather than jumping.");
        if (this.step === 0) {
          this.step = 1;
          this.enter("turn", now);
        } else {
          this.enter("passed", now);
        }
      }
    } else {
      this.holdSince = null;
    }
    return {};
  }
}
