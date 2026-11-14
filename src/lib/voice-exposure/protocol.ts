import type { ScoredWindow, Segment } from "./verify";

/** Speaker embedding model: WeSpeaker ResNet34-LM (VoxCeleb), ONNX export. Licence CC-BY-4.0. */
export const SPEAKER_MODEL = {
  id: "onnx-community/wespeaker-voxceleb-resnet34-LM",
  revision: "6a61a1833ff2583aabeba044f5c8221f00b67ceb",
  licence: "CC-BY-4.0",
  credit: "WeSpeaker (wenet-e2e), trained on VoxCeleb; ONNX by onnx-community",
};
/** Voice activity detection: Silero VAD v5, ONNX. Licence MIT. */
export const VAD_MODEL = {
  id: "onnx-community/silero-vad",
  revision: "e71cae966052b992a7eca6b17738916ce0eca4ec",
  licence: "MIT",
  credit: "Silero Team",
};

export type Dtype = "fp32" | "q8";

export type WorkerRequest =
  | { id: number; type: "load"; dtype: Dtype }
  | { id: number; type: "analyse"; pcm: Float32Array; reference?: Float32Array; keepEmbeddings?: boolean };

export interface AnalyseResult {
  speechSeconds: number;
  segments: Segment[];
  windows: (ScoredWindow & { embedding?: Float32Array })[];
  ms: { vad: number; embed: number };
}

export type WorkerResponse =
  | { id: number; type: "progress"; loaded: number; total: number }
  | { id: number; type: "loaded"; bytes: number; ms: number; dtype: Dtype }
  | { id: number; type: "analysed"; result: AnalyseResult }
  | { id: number; type: "error"; message: string };
