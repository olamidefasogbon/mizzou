// SSE event contract for POST /api/chat (PROMPT.md section 5.4).
// Types are defined once here and shared with the web client.

export type RunEvent =
  | { t: "message"; id: string; text: string } // assistant bubble, may stream deltas
  | { t: "status"; id: string; label: string; state: "active" | "done" | "failed" }
  | { t: "card"; id: string; kind: "program" | "fit" | "requirements" | "plan" | "draft" | "pack" | "coverage" | "rolling_notice"; payload: unknown }
  | { t: "needs_approval"; gate: "G1" | "G2" | "G3" | "G4" | "G5"; card: unknown }
  | { t: "continue"; runId: string }
  | { t: "done"; runId: string }
  | { t: "error"; friendly: string; link?: string };

/** Encode one newline-delimited SSE event (`data: {...}\n\n`). */
export function encodeSseEvent(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
