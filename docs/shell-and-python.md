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

A command meant to be copied and pasted never contains an unfilled
placeholder. An unknown value is read into a shell variable first
(`read -rs NAME; export NAME`), and the command uses the variable.

**Why:** a placeholder pasted by mistake runs with a wrong value, and a secret
typed into a command line lands in the shell's history.

**Check plan:** a docs-lint rule for placeholder-shaped tokens inside fenced
shell blocks.
