# lintCoverageGate.ts

For people maintaining or extending this gate.

The extension-to-tool table is fixed, like `PYTHON_TOOLS` in
`pythonConfigGate.ts` — only the pre-commit config's filename is configurable
(`LINT-2`/`LINT-4` `precommit_config_file`, read separately per clause though
both default to the same file, so either clause can be repointed on its own
later).

LINT-4 is checked only for a rule LINT-2 already passed: if pre-commit
configures no tool for a file type at all, that is LINT-2's finding, and
asking "does CI run it too" about a tool that does not exist would just
duplicate it under a second clause.

`extractRunStepBodies`/`stripYamlComments` are `pythonToolInvocation.ts`'s —
reused here rather than re-implemented, the same YAML-aware `run:` matcher
`PythonConfigGate` already uses to tell a real invocation from a comment
mentioning a tool's name.

`.pre-commit-config.yaml` and every workflow file are themselves tracked
`.yaml`/`.yml` files, so the YAML rule applies to them too — this is
deliberate, not an edge case worth suppressing: LINT-2's text names YAML as
code-like with no carve-out for a repo's own tooling config, and a repo that
hand-edits those files without a formatter is exactly the drift LINT-2
exists to catch.
