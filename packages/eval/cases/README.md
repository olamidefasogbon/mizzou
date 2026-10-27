# Eval cases (M2)

10 real opportunities, hand-labeled by the human on or after Oct 27, with the
correct values. Mix: clean pages, JavaScript-heavy pages, PDFs, flyers, and
two non-academic items (a job posting and a conference call for papers).

File shape (see `case-01.template.json`):

```json
{ "id": "case-01", "kind": "program",
  "input": { "type": "url", "value": "https://..." },
  "expected": { "opens": "...", "deadlines": [], "documents": [], "unusual_rules": [] },
  "notes": "", "labeled": true }
```

Rules:
- Only cases with `"labeled": true` and a non-null `expected` run.
- Never commit a real API key or personal data in a case file.
- The runner defaults to `--limit 2`. A full 10-case run only on request.
