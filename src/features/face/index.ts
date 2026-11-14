export { LivenessScan, type LivenessScanProps } from "./LivenessScan";
export { PhotoMatches, type PhotoMatchesProps } from "./PhotoMatches";
export { usePhotoMatches, useFaceReference, type PhotoMatchState } from "./usePhotoMatches";
export {
  clearFaceData,
  matchFaces,
  DEFAULT_MATCH_THRESHOLD,
  type FaceReference,
  type LivenessResult,
  type MatchResult,
  type MatchOptions,
  type FaceBox,
} from "@/lib/face";
