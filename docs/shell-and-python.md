# Shell and Python

Scripts and tooling are software like any other and meet the same standards.
Typed, testable languages are preferred to shell, and Python is held to the
same rigour as TypeScript.

This repo's own gate scripts are shell today. They stay as they are until the
whole toolchain moves to a typed language as one piece of work, so nothing is
rewritten twice; until then they meet `SH-1`.

## Shell

### SH-1 — shell meets the same standard as other code

Shell is allowed only when it carries tests to the same standard as any other
code — fakes for what it calls, and proof that a deliberate break turns the
tests red — and passes shellcheck with no warnings.

**Why:** a script that deploys or guards something is a software artefact,
and shell is otherwise the least tested code in a repo.

**Check plan:** shellcheck in pre-commit and CI; the `COV-1` coverage reader
extended to shell through kcov.

### SH-2 — runbooks may use shell for manual tasks

A runbook may use shell for a manual task. A runbook step that an agent runs is
still manual.

**Why:** a person or an agent choosing to run a command is not an automated
system; automated steps belong in tested code (`OPS-6`).

**Check plan:** review; shell in a runbook is outside `SH-1`, and shell
anywhere else is not.

### SH-3 — a typed language and its SDKs first

Anything beyond basic commands is written in a typed language, Python or
TypeScript, using a tool's own SDK where one exists rather than a script of
subprocess calls.

**Why:** typed, testable code is easier to trust than shell, and wrapping a
command line in subprocess calls keeps shell's weaknesses in another language.

**Check plan:** review of new scripts in the diff.

### SH-4 — no unfilled placeholders in commands to copy

This clause is scoped by context, not blanket. A fenced shell block meant to
be copied and pasted verbatim never contains an unfilled placeholder: an
unknown value is read into a shell variable first (`read -rs NAME; export
NAME`), and the command uses the variable (`$NAME`). Prose, templates and
legal documents are a different context and keep `[ALL_CAPS]` placeholders —
nobody pastes a contract clause or a template paragraph into a terminal, and
an all-caps bracketed token reads unambiguously as "fill this in" in running
text.

**Why:** a placeholder pasted by mistake into a shell runs with a wrong
value, and a secret typed into a command line lands in the shell's history.
Neither risk exists in prose.

**Check plan:** a docs-lint rule for placeholder-shaped tokens inside fenced
shell blocks meant to be copied — not inside prose, templates or legal
documents, where `[ALL_CAPS]` stays correct.

## Python

### PY-1 — TypeScript for services, Python when a library needs it

Services are written in TypeScript. A deployed service is written in Python
only when a library it needs forces that choice.

**Why:** one service language keeps the stack small, and Python earns its
place where its libraries are the best tool for the job.

**Check plan:** review; a new Python service names the library that requires
it.

### PY-2 — Python gets the same rigour

Python code runs mypy in strict mode, and ruff for linting and formatting, in
pre-commit and CI, with every signature annotated (`TYP-2`).

**Why:** Python used for services or tooling is software like any other, and
dynamic typing is no excuse for untyped code.

**Check plan:** a check that each Python project configures strict mypy and
ruff, and that CI runs both.

### PY-3 — a declared minimum version

Every Python project declares its minimum Python version (`requires-python`),
and ruff and mypy target that version.

**Why:** a checker aimed at the wrong version passes code that fails at
runtime.

**Check plan:** a check that `pyproject.toml` sets `requires-python` and that
ruff's `target-version` and mypy's `python_version` match it.

## The shared ruff and mypy configuration

`templates/ruff.toml` and `templates/mypy.ini`, synced through `SYNC-1` like
`.pre-commit-config.yaml`, are how PY-2 gets a consistent rule set rather than
each repo hand-rolling one. Each rule selection traces to a clause rather
than being a taste choice:

| Selection                           | Clause | Why                                                           |
| ----------------------------------- | ------ | ------------------------------------------------------------- |
| ruff `TRY`                          | ERR-1  | own named error types; `TRY002` bans a bare `raise Exception` |
| ruff `BLE`                          | ERR-3  | a caught error is never silently discarded                    |
| ruff `DOC501`                       | ERR-2  | a docstring lists what a function raises                      |
| ruff `N`                            | NAM-2  | pep8-naming, each language's own casing convention            |
| ruff `ANN`                          | TYP-2  | every signature fully typed; `ANN401` alone is TYP-1          |
| ruff `S`                            | SEC-8  | flake8-bandit static security rules, run in pre-commit        |
| mypy `strict = True`                | TYP-5  | maximum strictness; includes TYP-2's `disallow_untyped_defs`  |
| mypy `disallow_any_explicit = True` | TYP-1  | strict mode alone does not ban an explicit `Any`              |

ARCH-4 (one class per file) and ARCH-7 (cognitive complexity) are in this
work's scope but not in the ruff config: their own check plans name an
ast-grep rule and `complexipy` respectively, neither of which is a ruff or
mypy setting.

`target-version` and `python_version` are deliberately not in the shared
template — PY-3 requires them to match each project's own `requires-python`,
which differs per repo. Ruff infers `target-version` from `requires-python`
when it is unset, so the template omits it entirely; mypy has no equivalent
inference, so each repo adds `python_version = ...` as a plain line inside
the _same_ `[mypy]` section the shared block opens — never a second `[mypy]`
header (see below for why that specific mistake is worse than it looks).
`tools/ts/src/pythonConfigGate.ts` checks both directly against
`requires-python`, independently of `SYNC-1`.

## Why `DOC501` is selected explicitly, with preview on

`DOC501` (ERR-2's docstring-lists-what-it-raises rule) ships in ruff as a
**preview** rule: selecting the `DOC` prefix alone does nothing until
`preview = true` is also set — ruff 0.16.9 reports "Selection `DOC` has no
effect because preview is not enabled" and enforces zero `DOC` rules. Turning
on `preview` globally would also light up every other preview-only rule
hiding under `TRY`/`BLE`/`N`/`ANN`/`S`'s prefixes, none of which this policy
has reviewed. `explicit-preview-rules = true` closes that gap: with it set,
a preview rule is enabled only when its own code is named directly, never by
a prefix it happens to share — so `extend-select`'s `DOC501` turns on exactly
one rule, and `preview = true` on its own enables nothing further.

## Why `mypy.ini` stays on `contains`, and what actually guards it

The first version of this section proposed moving `mypy.ini` to `suffix`
mode on the theory that mypy resolves a key repeated across two `[mypy]`
sections the way Python's `configparser` does on its own — keeping whichever
occurrence it read last. **A real mypy 1.19.0 run disproved that.** Given a
file with two `[mypy]` sections, in _either_ order, mypy prints a single
non-fatal `section 'mypy' already exists` warning and then applies **none**
of the file's settings at all — not the first section's, not the last's —
and runs with its untyped defaults. Ordering the shared block last (what
`suffix` would enforce) makes no difference to this outcome, so `suffix`
would have added a real constraint (repos could no longer append their own
`[mypy]` section for `python_version`, the one place customisation is
needed) while fixing nothing.

`mypy.ini` therefore stays on `contains`, and the template's own comment says
directly what `suffix` can't express: add `python_version` as a plain line
inside the _same_ `[mypy]` section the shared block opens, never a second
`[mypy]` header. The real guard against someone doing it wrong anyway is
mechanical, not positional: `tools/ts/src/pythonConfigGate.ts` counts
`[mypy]` headers in a project's standalone mypy config and reports TYP-5 the
moment there is more than one, regardless of where the extra one sits —
catching the actual failure mode a line-position check cannot.

`ruff.toml` stays on `contains` too, for an unrelated and much simpler
reason confirmed the same way: a second `[lint]` table anywhere in the same
TOML file is a hard parse error — ruff exits non-zero and runs nothing
rather than silently picking one — so there is no silent-override case here
for any comparison mode to defend against.
