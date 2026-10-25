# Shell and Python

Scripts and tooling are software like any other: typed, testable languages are preferred to shell, and Python is held to the same rigour as TypeScript. This repo's own gate scripts are shell today and stay so until the whole toolchain moves to a typed language as one piece of work; until then they meet `SH-1`.

## Shell

### SH-1 — shell meets the same standard as other code

Shell is allowed only when it carries tests to the same standard as other code (fakes for what it calls, and proof that a deliberate break turns the tests red) and passes shellcheck with no warnings.

**Why:** a script that deploys or guards something is a software artefact, and shell is otherwise the least tested code in a repo.

**Check:** shellcheck in pre-commit and CI; the `COV-1` reader extended to shell through kcov.

### SH-2 — runbooks may use shell for manual tasks

A runbook may use shell for a manual task, and a runbook step an agent runs is still manual.

**Why:** a person or agent choosing to run a command is not an automated system, and automated steps belong in tested code (`OPS-6`).

**Check:** review; shell in a runbook is outside `SH-1`, and shell anywhere else is not.

### SH-3 — a typed language and its SDKs first

Anything beyond basic commands is written in a typed language, Python or TypeScript, using a tool's own SDK where one exists rather than a script of subprocess calls.

**Why:** typed, testable code is easier to trust than shell, and wrapping a command line in subprocess calls keeps shell's weaknesses in another language.

**Check:** review of new scripts in the diff.

### SH-4 — no unfilled placeholders in commands to copy

A fenced shell block meant to be copied and pasted verbatim never contains an unfilled placeholder: an unknown value is read into a variable first (`read -rs NAME; export NAME`) and the command uses `$NAME`, while prose, templates and legal documents keep `[ALL_CAPS]` placeholders.

**Why:** a placeholder pasted by mistake runs with a wrong value and a secret typed into a command line lands in shell history, neither of which happens in prose.

**Check:** a docs-lint rule for placeholder-shaped tokens inside fenced shell blocks meant to be copied, not in prose, templates or legal documents.

## Python

### PY-1 — TypeScript for services, Python when a library needs it

Services are written in TypeScript, and a deployed service is written in Python only when a library it needs forces that choice.

**Why:** one service language keeps the stack small, and Python earns its place where its libraries are the best tool.

**Check:** review; a new Python service names the library that requires it.

### PY-2 — Python gets the same rigour

Python code runs mypy in strict mode and ruff for linting and formatting in pre-commit and CI, with every signature annotated (`TYP-2`).

**Why:** Python used for services or tooling is software like any other, and dynamic typing is no excuse for untyped code.

**Check:** each Python project configures strict mypy and ruff and CI runs both.

### PY-3 — a declared minimum version

Every Python project declares its minimum Python version (`requires-python`), and ruff and mypy target that version.

**Why:** a checker aimed at the wrong version passes code that fails at runtime.

**Check:** `pyproject.toml` sets `requires-python` and ruff's `target-version` and mypy's `python_version` match it (`tools/ts/src/pythonConfigGate.ts`).

## The shared ruff and mypy configuration

`templates/ruff.toml` and `templates/mypy.ini`, synced through `SYNC-1`, give `PY-2` one rule set, and each selection traces to a clause:

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

`ARCH-4` and `ARCH-7` are not in the ruff config: their checks are an ast-grep rule and `complexipy`. `target-version` and `python_version` are left out of the templates because `PY-3` requires them to match each project's `requires-python`: ruff infers `target-version` from it, and mypy has no such inference, so each repo adds `python_version = ...` as a plain line in the same `[mypy]` section the shared block opens, never a second `[mypy]` header.

`DOC501` is a ruff preview rule, dead unless `preview = true`, and `explicit-preview-rules = true` keeps that from enabling any other preview rule under the `TRY`, `BLE`, `N`, `ANN` or `S` prefixes, so only a code named directly selects one.

`mypy.ini` stays on `contains` and not `suffix` because a real mypy 1.19.0 run showed that two `[mypy]` sections, in either order, make mypy apply none of the file's settings, so ordering would fix nothing; the guard is mechanical, and `tools/ts/src/pythonConfigGate.ts` reports `TYP-5` the moment a project's mypy config has more than one `[mypy]` header. `ruff.toml` stays on `contains` because a second `[lint]` table is a hard parse error, so nothing can silently override.
