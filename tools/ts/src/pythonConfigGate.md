# pythonConfigGate.ts

For people maintaining or extending the standards tools.

PY-2, PY-3 and TYP-5 all stay `pending` in `docs/index.md`: no owner has yet
reviewed moving Python checkers to `auto`, and every finding this gate
produces is `advisory`, never a failure — the same rollout `schemaDriftGate.ts`
and `migrationClassifierGate.ts` use for DB-4 through DB-6.
`tools/thresholds.tsv` carries the `#provisional` reader rows
`check-clause-index.sh` requires before a `pending` clause may be named by a
real script.

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
