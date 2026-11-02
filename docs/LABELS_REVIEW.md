# Review of packages/eval/cases/labels-draft.json against the saved fixtures

Method: every `line` was matched against the visible text of its fixture(s)
(tags, scripts and comments removed, entities decoded, dash and quote
variants normalised, table cells treated as separators). Every number inside
a `value` was then checked to appear in its own `line`. Run on all 9 cases
(case-02 to case-10 fixtures, including the FAQ and recruitment pages).

Result: 80 quoted lines checked. 69 are exact fixture text and every number in
their values appears in the line. 11 lines do not match the fixture, 1 value
carries a fact its line does not show, and 2 values are guesses with no line.
None of the 14 items is safe to lock as a label until fixed as below.

## Wrong quote (fix before use)

| Case / field | Problem | Fix |
|---|---|---|
| case-06 hard_rules[1] | Draft says "90% ... GPA above 3.5". The fixture (case-06-faqs) says "90% of admitted applicants have a GPA above 3.3, and 75% have a GPA above 3.5". The value "typically above 3.5" repeats the error. | Quote the real sentence. Value: "90% above 3.3, 75% above 3.5, minimum 3.0 (fellowship admission, not VSRP)". |
| case-03 documents[2], [3] | Not exact. Fixture: "...statement of purpose (i.e., research statement/motivation letter), and a scan of your passport or national ID document (if you do not have a passport yet)". Draft drops a comma and ends in "passpo[rt]". | Use the full sentence verbatim. documents[3] is a fragment of documents[2]. |
| case-02 program | Fixture title is "CaCTüS - Computation and Cognition Tübingen Summer Internship". Draft has "CaCTuS" (no umlaut) and an em dash. | Copy the title exactly. |

## Value goes beyond its line

| Case / field | Problem | Fix |
|---|---|---|
| case-03 buried_rules[1] | Value includes "longer than 3 months only with ECTS recognition and host professor agreement". The quoted line only covers "May to October, not before May 1". The extra claim is in case-03-faq ("you will get ECTS credits for it ... if the host professor agrees, the internship duration can be longer than 3 months") but is not quoted. | Split into two labels, each with its own exact line. |

## Guesses and absence claims (not quotes)

These put a note in the `line` field, or set a value with no line. They are
interpretations of what the page does not say, not evidence. Set the value to
null, keep needs_human true, and move the note to a `note` field.

| Case / field | What it says | Why it is not evidence |
|---|---|---|
| case-06 hard_rules[0] | "VSRP year/CGPA rules: not stated (sheet claims 3rd year and 4.375 CGPA; absent)" | Value set, no line. Absence claim plus a sheet claim. |
| case-07 hard_rules[2] | "Project/supervisor pre-matching rule: not stated in fixture" | Value set, no line. Absence claim. |
| case-03 fee | line is "... (visa fees only; no application fee stated)" | The visa-fee half is a real quote ("fees when retrieving the visa ... at the student's charge"); "no application fee stated" is the author's inference. Keep only the quote. |
| case-05 fee | line "Scholarships will fund your exploration (support, not a fee)" | The first half is real fixture text; "not a fee" is inference, the page never says there is no fee. |
| case-05 documents | "Review the FAQ page before applying (FAQ page is not in the fixtures)" | An instruction, not page text. |
| case-06 fee | "$1,320 is monthly living cost, not a fee" | The fixture says students spend around $1,320 per month (cost of living). "Not a fee" is inference. |
| case-08 fee | "No application fee stated; NTD 30,000/month stipend is support" | The stipend text is real. "No fee stated" holds only because the word "fee" does not appear; label it as absence, not a quote. |
| case-09 deadlines | "complete the online application before the deadline (no date stated anywhere in either fixture)" | Absence claim. A null with needs_human is the honest label. |

## Looks like a mismatch but is fine

case-02 buried_rules[0] "12 Internship spots per year" is the stat tile
"12" next to "Internship spots per year" in the fixture, split across two
elements. Keep it, and note that it is a joined tile.

## What the labels still cannot show

Every date label in case-02 has needs_human true because the fixture gives no
time zone. That is right: do not turn a bare "Nov 16, 2026" into a UTC instant
for scoring. Ola has to confirm each of those against the live page.
