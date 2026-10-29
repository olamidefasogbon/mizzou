# Meta API notes (day-one checks, PROMPT.md section 4)

Verified Oct 27, 2026 via live calls from this repo (no SDK changes needed).
Spend on verification so far is logged in STATUS.md (all runs under $0.05).

## 1. `POST /v1/responses` to `muse-spark-1.3` — VERIFIED

Minimal request (no key needed to reach the endpoint; key required to succeed):

```bash
curl -s https://api.meta.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MODEL_API_KEY" \
  -d '{"model":"muse-spark-1.3","input":"Reply with exactly: ok"}'
```

Without a key the API returns HTTP 401 (proves endpoint + auth scheme):

```json
{"error":{"code":"invalid_api_key","message":"Unauthorized","param":null,"type":"authentication_error"}}
```

With a key: HTTP 200, OpenAI-Responses-style envelope. Observed top-level keys:

```
background, completed_at, created_at, error, id, incomplete_details,
instructions, model, object, output, parallel_tool_calls, reasoning,
service_tier, status, store, temperature, tool_choice, tools,
top_logprobs, top_p, truncation, usage
```

- `object: "response"`, `status: "completed"`, `id: "resp_<hex>"`,
  `model: "muse-spark-1.3"`, `created_at`/`completed_at` epoch floats.
- `output[]` items: `{"type":"reasoning",...,"summary":[],"status":"completed"}`
  then `{"type":"message","role":"assistant","content":[{"type":"output_text","text":"...","annotations":[],"logprobs":[]}]}`.
- `usage`: `{input_tokens, input_tokens_details:{cached_tokens}, output_tokens,
  output_tokens_details:{reasoning_tokens}, total_tokens}`.
  **Billing-relevant: output_tokens INCLUDES reasoning tokens.**
- Observed defaults: `temperature: 1.0`, `top_p: 1.0`,
  `reasoning: {effort: "high"}`, `truncation: "disabled"`,
  `parallel_tool_calls: true`, `store: true`, `service_tier: "auto"`,
  `instructions: null`.
- `reasoning: {effort}` accepts `"low"` and `"minimal"` (OpenAI shape).
  On the "ok" probe: high → 320 reasoning tokens, low → 105, minimal → 5
  (output_tokens 330 → 115 → 15). The reader role must use minimal.
- `store: true` default suggests server-managed state exists; retrieval is
  NOT yet verified, so the runs table still stores full message history.
- Billing page $150 credit + spend-limit notification: NOT verified here
  (dashboard-side, needs a human).

## 2. Chat Completions compatibility (`callModel` path) — VERIFIED

`packages/core/src/meta/callModel.ts` uses the OpenAI SDK chat-completions
endpoint against `https://api.meta.ai/v1`. The M2 baseline ran end to end
through it (reader role, `response_format: {type:"json_object"}`, one repair
retry) and returned schema-valid extraction. So both `/v1/responses` and the
SDK chat-completions path work with `muse-spark-1.3`.

## 3. Built-in search tool syntax / citations / billing — VERIFIED (M4 step 1)

One minimal-effort call, prompt "Use the web_search tool to check: which
university hosts the OIST research internship program? ...", with
`"tools": [{"type": "web_search"}]` (OpenAI Responses shape — accepted as-is).

Observed item flow in `output[]`: `reasoning` → `message` ("I'll search to
confirm ...") → `web_search_call` → `reasoning` → final `message`.
`web_search_call` shape:

```json
{"type": "web_search_call", "id": "ws_call_<uuid>", "status": "completed",
 "action": {"type": "search", "query": "<model-written query>"}}
```

- No separate citations came back on this call: both messages carry
  `annotations: []`, and the final answer folds the result into plain text.
  A citations-bearing shape (URL annotations) is NOT yet observed — the
  orchestrator must not assume `annotations[0].url` exists.
- Message items now carry an extra `phase` key vs the day-one shape.
- `usage` for this call: `{input_tokens: 2152, output_tokens: 171,
  reasoning_tokens: 37}` — input is large for a short prompt (search
  context counts as input). No separate search line item in `usage`;
  search billing is dashboard-side (spec list price $2.50 / 1k queries).
- Model cost of the probe: 2152/1e6×$1.25 + 171/1e6×$4.25 ≈ **$0.0034**.

## 4. Structured output parameter — PARTIAL

`response_format: {type:"json_object"}` works on the chat-completions path
(baseline extraction validated against the zod schema after one repair).
Native Responses-API structured-output parameter shape still unverified.

## 5. Function-calling loop shape — PENDING

Call ids, parallel calls, streamed arguments not yet observed (needed M4).

## 6. Streaming event format; error/429 shapes — PENDING

No streaming or 429 encountered yet. `callModel` backs off on 429 (max 3
attempts); the exact 429 body is unrecorded.

## 7. Image input format — PENDING

Needed for the vision role (flyers, M5). Not yet attempted.

## 8. SAM 3.1 + speech endpoint shapes — PENDING

Only if M9 is built.

Base URL: `https://api.meta.ai/v1`. Auth: bearer key in `MODEL_API_KEY`
(`META_API_KEY` accepted as a local fallback).
