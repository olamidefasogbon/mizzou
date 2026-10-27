# Meta API notes (day-one checks, PROMPT.md section 4)

Status: UNVERIFIED. No live calls have been made from this repo yet
(spend so far: $0.00). Each item below needs a real call or doc check,
then a working request example pasted here. Nothing that depends on these
shapes is implemented against them yet.

1. `POST /v1/responses` to `muse-spark-1.3` with the repo key; billing shows
   the $150 credit; a spend-limit notification is set. — PENDING
2. Built-in search tool syntax, citation shape, and how search is billed. — PENDING
3. Structured output parameter + function-calling loop shape (call ids,
   parallel calls, streamed arguments). Code currently uses the
   `response_format: { type: 'json_object' }` chat-completions shape as a
   placeholder until this is verified. — PENDING
4. Streaming event format for the Responses API; error and 429 shapes. — PENDING
5. Image input format on the endpoint in use. — PENDING
6. Reasoning replay / server-managed state: assumed ABSENT, so the runs table
   must store full message history (see section 5.3). Revisit if verified. — PENDING
7. SAM 3.1 + speech endpoint request shapes (only if M9 is built). — PENDING

Base URL: `https://api.meta.ai/v1`. Auth: bearer key in `MODEL_API_KEY`
(`META_API_KEY` accepted as a local fallback).
