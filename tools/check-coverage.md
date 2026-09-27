# check-coverage.sh

COV-1 — a reader over `coverage/coverage-final.json`, not yet a gate.

COV-1 stays `pending` in `docs/index.md` — no gate has ever computed it, and
this script does not change that. The threshold below is a provisional
setting in `tools/thresholds.tsv`, not an owner-set floor, so every finding
reports through `ratchet_finding_advisory()` at level "advisory" and never
fails a build. Flipping the gate class to `auto` is a separate, later,
reviewed change, made once the owner has actually chosen the number.

Reads `coverage/coverage-final.json` — the Istanbul/V8 json reporter's
output, which is what `@branchleft/vitest-config`'s `coverage.reporter`
includes — if the consuming repo has one. Absent entirely, that is reported
as a single informational line, not a failure: most repos have not run
coverage with this shape yet, and "no data" is a different fact from "data
below floor".

Scoped to ratchet's own changed-file set (`RATCHET_TMP/enforced`): in enforce
mode that is every tracked file, in warn mode only what the branch touched —
the same distinction every other gate in this repo already makes.

The JSON parsing itself is delegated to `tools/lib/coverage-lines.mjs`. A repo
with a `coverage-final.json` to read already has Node, because vitest wrote
that file — unlike the rest of tools/, which stays pure bash+awk+grep so the
three repos with no package.json can still run it.
