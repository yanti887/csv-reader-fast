# Fast CSV Reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/yanti887/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/yanti887/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0, written for make.fun's "Read broken CSV files faster, 21 November 2026" bounty. `run(input)` returns exactly what csv-reader 1.0.0 returns for `{text, header}` — `{columns, rows, errors}` — but **4.4–5.3x faster** on parsing (1.7–2.1x faster end-to-end including JSON I/O).

## Approach

One left-to-right pass, same broken-row semantics as the reference, but:
- Each field is extracted with a single `slice()` (not one-character-at-a-time appends); multiple slices are joined only when a stray CR, doubled quote, or CR inside quotes splits it.
- Character comparisons use `charCodeAt` (numbers), not one-character strings.
- No result object is allocated per field — how a field ended and how much junk it added live in two closure variables.
- No regex, no splitting the text into lines. `main.ts` turns V8's incremental marking off before importing `solve.js`, as the baseline does.

## Verification

- Practice set: **6/6 cases** JSON-identical to the reference.
- Edge cases: **49/49** (BOM, stray CR, unterminated quote, quote_junk, short/long rows, quoted CRLF/CR, empty lines, empty header).
- Fuzz: **4000/4000 + 3000/3000** differential tests vs the reference.
- Official kit grader (`grade-local`): `cases_passed 6/6`, `passed 1`, eligible for ranking and prize.
- Determinism: two runs produce byte-identical `answers.json`.

## Run it

`main.ts` reads `/input/cases.json` and writes `/output/answers.json`.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards
