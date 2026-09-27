# ratchet.sh

Shared ratchet mechanism for every standards gate.

Sourced, not executed. Consumers set their own shell options; this library
deliberately does not set `-e`, because a gate must keep scanning after a
failing grep rather than abort on the first non-match.

No runtime dependencies beyond bash + grep + awk + git, because three of the
repos this runs in have no package.json and no Node.

## Contract

```text
ratchet_init [--mode warn|enforce] [--json] [FILE...]
ratchet_scope_files <extension-regex>   -> newline-separated existing paths
ratchet_finding <clause> <file> <line> <message>
ratchet_summary                          -> prints totals, returns exit code
```

A finding on a file outside the enforced set is emitted as a warning and does
not affect the exit code. That is the whole ratchet: the legacy tree is
advisory, the code this branch touched is not.
