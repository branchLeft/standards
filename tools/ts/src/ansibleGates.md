# The Ansible gates

For people maintaining or extending the readers for `ANS-2` to `ANS-9`,
`ANS-11` and `ANS-15`. They run in the TypeScript audit, advisory only: every
finding is level `advisory`, and all ten clauses stay `pending` in
`docs/index.md` until the owner moves the gate class (the same rollout the
Python and Compose readers use). Each reads a setting from
`tools/thresholds.tsv`, so each shows as measured, not enforced. A repo with
nothing tracked under `ansible/` gets no findings.

| File                      | Clauses              | Reads                                                         |
| ------------------------- | -------------------- | ------------------------------------------------------------- |
| `ansibleTaskGate.ts`      | ANS-3, ANS-8, ANS-9  | task and handler files, plus play, meta and Molecule keywords |
| `ansibleRoleGate.ts`      | ANS-2, ANS-7, ANS-8  | a role's `library/`, spec and defaults                        |
| `ansibleMoleculeGate.ts`  | ANS-11, ANS-15       | `molecule/default/` of each role                              |
| `ansibleToolchainGate.ts` | ANS-2, ANS-4         | `ansible/pyproject.toml`, requirements, `requirements.yml`    |
| `ansibleLintGate.ts`      | ANS-5, ANS-6, ANS-15 | `.ansible-lint`, `.yamllint`, workflows, pre-commit           |

## The YAML reader

`ansibleYaml.ts` wraps the Compose-shaped subset parser (`composeYaml.ts`),
which stops reading a document at a block scalar and at a scalar that runs onto
more lines. Before parsing, every such scalar has its body blanked and its value
replaced by `MULTILINE_SCALAR`, so the line count and every node's line number
are unchanged and the tasks after it are still read. The text inside is lost on
purpose, which also means a mention of `shell:` in a block scalar is never read
as a task. A reader that compares two values skips a pair where one is that
marker. Every file is read through `readText`, which strips a byte-order mark
and folds CRLF.

The parser keeps a flow map (`driver: {name: docker}`) as the text of a scalar,
so a reader looking for `driver.name` would find nothing in a valid file. After
parsing, every scalar that spells a balanced `{...}` is replaced by the map it
spells, nested maps and flow sequences included, and a flow map that opens a
line (a whole document, or a list item) is given a throwaway key first so it is
not read as a block key. Each key and value carries the line the flow map began
on. Two limits: a quoted string that is itself written as `{...}` is read as a
map, because its quotes are gone by then, and a template (`{{ ... }}`) never is.
A reader that compares a spec default with a role default sees a map on both
sides and skips the pair, as it skips any value that is not a scalar.

## What each clause leaves to review or to another tool

The Check line of each clause names a tool or a review for the part below, and
the reader does not pretend to cover it.

- ANS-2: signatures annotated, mypy strict and ruff in CI are `TYP-2`, `TYP-5`
  and `PY-2`; "unit tested" and "oldest interpreter any host provides" are
  review. The reader checks `requires-python` exists, mypy ignores missing
  imports only in an override naming `ansible.*`, and each module carries its
  three documentation blocks and `supports_check_mode=True`.
- ANS-3: whether a task's program is "a program the role installs" is the file
  the role ships, which is not a task, so nothing is excepted.
- ANS-4: the vendored copy of a collection against its pin, and a bump's review.
  The `ansible` package is accepted in place of `ansible-core` because it pins
  the core it carries.
- ANS-5: the routes are those in ansible-lint's documentation. Flags are read
  only on the line that names `ansible-lint` (a continuation line is missed),
  and only in workflows and the pre-commit file. A `noqa` needs a comment on the
  line directly above it, so each line of a run of `noqa` lines under one shared
  comment is flagged.
- ANS-6: that yamllint runs over every file under `ansible/` is checked as "a
  step runs yamllint", not by its arguments.
- ANS-7: the spec against the variables the tasks read, and the `choices` a
  closed set needs, are review. Defaults are compared by literal value only.
- ANS-8: the `fqcn` rule of the production profile covers task module names.
  The reader covers the `collections:` keyword, a bare library module name and a
  bare `lookup`/`query` plugin name; a filter named without its collection is
  review.
- ANS-9: `command-instead-of-module`, `command-instead-of-shell` and
  `no-changed-when` stay with ansible-lint. The reader covers the argument-list
  form and a shell run through `command`; "a command needed twice" is review.
- ANS-11: the Molecule run in CI is the proof. The reader checks the scenario
  keeps `idempotence` in an explicit `test_sequence`.
- ANS-15: CI running the default sequence and the `check` action, the blocking
  list and the daily run are review. The reader checks the scenario files, the
  driver, the digest, `pre_build_image`, `docker_host`, a repository inventory,
  an unexplained privileged platform, an assert task, and `DOCKER_HOST` in
  workflows.
