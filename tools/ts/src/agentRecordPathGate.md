# agentRecordPathGate.ts

For people maintaining or extending this gate.

SEC-11 stays `pending` in `docs/index.md` and every finding is `advisory`. The
clause has two halves: a secret scan (CRED-11, read by `scannerWiringGate.ts`)
and a path rule refusing transcript and memory files in any repo. This is the
path rule.

The `SEC-11 agent_record_paths` row in `tools/thresholds.tsv` lists what to
refuse, and the owner has not set the real list, so it is `#provisional`. An
entry ending in `/` is a directory at any depth; any other entry is a file
name matched whole, so `MEMORY.md` flags `docs/MEMORY.md` and never
`NOT-MEMORY.md`. Paths are compared after folding case, turning backslashes
into slashes, collapsing doubled slashes and dropping a leading `./`, so none
of those hides a record.

It reads tracked paths only. It cannot tell a real transcript from a
deliberately committed test fixture with the same name (use an exemption row
with a reason), and it cannot see a record saved under a name outside the list
or pasted into an ordinary file; the secret scan and review cover those.
