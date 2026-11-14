# pythonConfigGate.ts

For people maintaining or extending the standards tools.

TYP-5 is listed in `tools/ts-promoted.tsv`, so its findings fail the Standards
job (changed files only in `warn` mode, every file in `enforce`). PY-2 and PY-3
are not listed: they stay `pending` and their findings stay `advisory`, because
every finding here reports through `findingPromotable`. `tools/thresholds.tsv`
keeps the `#provisional` reader rows for those two, which `check-clause-index.sh`
requires before a `pending` clause may be named by a real script. The TYP-5 row
is a plain fact about the tool: the config file names mypy itself reads.

## Why PY-2 cannot be promoted as it reads

Two shapes the standards themselves prescribe are reported as violations:

- A ruff config is looked up beside the project's own directory only, never in
  an ancestor, so the shared `.ruff.toml` that `SYNC-1` places at the repo root,
  next to a `pyproject.toml` under `ansible/`, reads as "no ruff configuration".
- Pre-commit is matched by hook id or upstream `repo:`, and CI by an invocation
  at the start of a command, so `uv run ruff check` or a local hook with its own
  id reads as "does not run ruff".

TYP-5 is unaffected: it speaks only when mypy configuration is found beside the
project. One known edge on it: a `setup.cfg` with no `[mypy]` section counts as mypy
configuration, and takes precedence over a `[tool.mypy]` table, so a repo that
keeps both reads as not strict.

## What counts as a project

`pythonProjectDiscovery.ts` groups tracked files into one project per
`pyproject.toml`, plus one project per directory of `.py` files no
`pyproject.toml` governs — a provisioning folder of loose scripts, for
example, `test_*.py` siblings included. A nested `pyproject.toml` claims its
own files over an ancestor's. A repo with neither shape reports nothing.

## What "configured" means

`pythonConfig.ts` reads the project's `pyproject.toml` plus whichever of
`ruff.toml`/`.ruff.toml` and `mypy.ini`/`setup.cfg` exist beside it (the
filename lists are `PY-2 ruff_config_filenames` and
`TYP-5 mypy_config_filenames` in `tools/thresholds.tsv`, overridable per the
usual pattern). Regex-based, like `migrationClassifier.ts` — it looks for a
`[tool.ruff]`/`[ruff]` or `[tool.mypy]`/`[mypy]` table, `strict = true` under
the mypy one, and the two version keys. It does not parse TOML or YAML
properly, so a value split across an unusual line shape can be missed; this
hasn't been observed in the fleet yet.

## Why ruff's `target-version` is optional but mypy's `python_version` is not

Ruff infers `target-version` from `project.requires-python` when the key is
absent, so an unset value is not a defect — only an explicit value that
disagrees with `requires-python`'s floor is a PY-3 finding. mypy has no such
inference: an absent `python_version` silently targets whatever interpreter
ran mypy, which drifts between a laptop and CI, so this gate requires it
explicitly and checks it matches.

## Pre-commit and CI are checked once per repo, not once per project

Multiple Python projects in one repo normally share one `.pre-commit-config.yaml`
and one CI workflow set, so PY-2's pre-commit and CI findings fire at most
once per audit run, attributed to the first project found, rather than once
per project — the same finding N times would just be noise.
