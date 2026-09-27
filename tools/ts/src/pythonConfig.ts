/** What a Python project's configuration text says about PY-2, PY-3 and TYP-5. */
export interface PythonProjectConfig {
  readonly requiresPython: string | undefined;
  readonly hasRuffConfig: boolean;
  readonly ruffTargetVersion: string | undefined;
  readonly hasMypyConfig: boolean;
  readonly mypyStrict: boolean;
  readonly mypyPythonVersion: string | undefined;
}

/** The raw text of each place a project's configuration can live. */
export interface PythonConfigSources {
  readonly pyprojectText: string | undefined;
  /** Content of a standalone `ruff.toml`/`.ruff.toml`, if one was found. */
  readonly ruffConfigText: string | undefined;
  /** Content of a standalone `mypy.ini`/`setup.cfg`, if one was found. */
  readonly mypyConfigText: string | undefined;
}

const REQUIRES_PYTHON = /requires-python\s*=\s*"([^"]+)"/;
const RUFF_TARGET_VERSION = /target-version\s*=\s*"([^"]+)"/;
const MYPY_STRICT = /^\s*strict\s*=\s*(true|True)\s*$/m;
const MYPY_PYTHON_VERSION = /python_version\s*=\s*"?([0-9]+\.[0-9]+)"?/;

// Everything from a `[tool.<prefix>...]` heading up to the next `[...]`
// heading — a plain line scan rather than a real TOML parser, like
// `migrationClassifier.ts`'s statement splitter. `prefix` is `tool.ruff` or
// `tool.mypy`; a bare `[tool.ruff]` and a nested `[tool.ruff.lint]` both
// count as the tool's own section.
function extractToolSection(pyprojectText: string, prefix: string): string {
  const collected: string[] = [];
  let inSection = false;
  for (const line of pyprojectText.split('\n')) {
    if (/^\s*\[/.test(line)) {
      inSection = line.trim().startsWith(`[${prefix}`);
    }
    if (inSection) {
      collected.push(line);
    }
  }
  return collected.join('\n');
}

/**
 * Parses PY-2/PY-3/TYP-5's inputs: a project's `pyproject.toml` plus whatever
 * standalone ruff and mypy config files sit beside it. Regex-based, like
 * `migrationClassifier.ts` — see `pythonConfigGate.md` for what this misses.
 * A standalone config file counts as "configured" the moment it exists,
 * since the whole file is that tool's; a `pyproject.toml` table only counts
 * once its own `[tool.ruff...]`/`[tool.mypy...]` heading appears.
 */
export function parsePythonProjectConfig(sources: PythonConfigSources): PythonProjectConfig {
  const pyproject = sources.pyprojectText ?? '';
  const ruffSection = extractToolSection(pyproject, 'tool.ruff');
  const mypySection = extractToolSection(pyproject, 'tool.mypy');

  const hasRuffConfig = sources.ruffConfigText !== undefined || ruffSection.trim() !== '';
  const hasMypyConfig = sources.mypyConfigText !== undefined || mypySection.trim() !== '';
  const ruffText = sources.ruffConfigText ?? ruffSection;
  const mypyText = sources.mypyConfigText ?? mypySection;

  return {
    requiresPython: REQUIRES_PYTHON.exec(pyproject)?.[1],
    hasRuffConfig,
    ruffTargetVersion: hasRuffConfig ? RUFF_TARGET_VERSION.exec(ruffText)?.[1] : undefined,
    hasMypyConfig,
    mypyStrict: hasMypyConfig && MYPY_STRICT.test(mypyText),
    mypyPythonVersion: hasMypyConfig ? MYPY_PYTHON_VERSION.exec(mypyText)?.[1] : undefined,
  };
}

/**
 * The floor version `requires-python` names — the first `major.minor` it
 * mentions, which is correct for every operator this repo's fleet uses
 * (`>=3.11`, `^3.11`, `~=3.11`, `>=3.11,<4.0`): the lower bound always comes
 * first. Returns `undefined` where nothing looks like a version.
 */
export function requiresPythonFloor(requiresPython: string): string | undefined {
  return /([0-9]+\.[0-9]+)/.exec(requiresPython)?.[1];
}

/** `3.11` → `py311`, ruff's own `target-version` token shape. */
export function ruffTargetVersionToken(floor: string): string {
  return `py${floor.replace('.', '')}`;
}
