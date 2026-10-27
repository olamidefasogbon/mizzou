export type ModelRole =
  | 'orchestrator'
  | 'reader'
  | 'judge'
  | 'writer'
  | 'vision'
  | 'voice';

export const ROLE_MODEL_MAP: Record<ModelRole, string> = {
  orchestrator: process.env.MODEL_ORCHESTRATOR || 'muse-spark-1.3',
  reader: process.env.MODEL_READER || 'muse-spark-1.3',
  judge: process.env.MODEL_JUDGE || 'muse-spark-1.3',
  writer: process.env.MODEL_WRITER || 'muse-spark-1.3',
  vision: process.env.MODEL_VISION || 'muse-spark-1.3',
  voice: process.env.MODEL_VOICE || 'muse-voice-transcribe-1.0',
};