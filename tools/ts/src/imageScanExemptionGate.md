# imageScanExemptionGate.ts

For people maintaining or extending this gate.

SEC-5 stays `pending` in `docs/index.md`, and every finding is `advisory`
until the clause is a row of `tools/ts-promoted.tsv`: the gate reports
through `findingPromotable`, so promoting it is that row, the `auto` index row
and a fixture in `tools/ts/test/promoted.e2e.test.ts`, as `docs/ratchet.md`
describes. Nothing here has a `tools/thresholds.tsv` row, because the 30 days
are the clause's own number, not a setting an owner tunes.

## What it reads

Every tracked `.image-scan-exemptions.json`, at any depth, and the first
CODEOWNERS file GitHub would use (`.github/CODEOWNERS`, then `CODEOWNERS`,
then `docs/CODEOWNERS`). The file is `{ "exemptions": [ ... ] }`. Each entry is
held to the five parts SEC-5 lists, and one finding is reported for each part
that falls short, against the line the entry starts on:

- Finding: `vulnerability`, `package`, `version`, `image` non-blank and free of
  `*` and `?`; `digest` matching `sha256:` and 64 lowercase hex digits;
  `severity` one of `critical`, `high`.
- Reason: `kind` one of `no-fix`, `false-positive`; `reason` non-blank;
  `evidence` non-blank when the kind is `false-positive`.
- Expiry: `granted` and `expires` real `YYYY-MM-DD` dates, `expires` after
  `granted` by at most 30 days, and not before today. The expiry day itself is
  still valid. The clock is read once per run, in `ImageScanExemptionGate`;
  the checker takes the day as an input.
- Owner: the file's last matching CODEOWNERS line names at least one owner. A
  later line that matches the path and names none releases it, which is how
  GitHub reads it. `codeowners.ts` reads patterns the way gitignore does:
  rooted with a leading `/`, any depth with no slash, a trailing `/` for a
  directory, `*` within a segment and `**` across them.
- Approval: an entry with `severity: critical` has `approval` with a non-blank
  `by` and `record` and a real `date`.

## What it cannot see

It cannot tell whether a reason is true or evidence is good: it checks that
each is present, and review reads the content. It cannot match an entry to a
scan result, so it cannot say an entry suppresses nothing or that a finding
lacks one; the reusable scan workflow, which reads the same file, is where an
entry takes effect. It does not read CODEOWNERS sections or the `@org/team`
membership, so an owner that does not exist or cannot approve passes. It
cannot see an exemption made outside the file (a scanner flag, a config of the
scanner's own); the scanner-wiring reader and review cover that.
