import { describe, expect, it } from 'vitest';
import {
  parsePythonProjectConfig,
  requiresPythonFloor,
  ruffTargetVersionToken,
} from './pythonConfig.ts';
import type { PythonConfigSources } from './pythonConfig.ts';

const EMPTY: PythonConfigSources = {
  pyprojectText: undefined,
  ruffConfigText: undefined,
  mypyConfigText: undefined,
};

describe('parsePythonProjectConfig', () => {
  it('reports nothing configured for an empty project', () => {
    expect(parsePythonProjectConfig(EMPTY)).toEqual({
      requiresPython: undefined,
      hasRuffConfig: false,
      ruffTargetVersion: undefined,
      hasMypyConfig: false,
      mypyStrict: false,
      mypyPythonVersion: undefined,
      mypyHasDuplicateSection: false,
    });
  });

  it('reads requires-python from a [project] table', () => {
    const pyprojectText = '[project]\nname = "x"\nrequires-python = ">=3.11"\n';
    expect(parsePythonProjectConfig({ ...EMPTY, pyprojectText }).requiresPython).toBe('>=3.11');
  });

  it('detects a [tool.ruff] table inside pyproject.toml and its target-version', () => {
    const pyprojectText = '[project]\nname = "x"\n\n[tool.ruff]\ntarget-version = "py311"\n';
    const config = parsePythonProjectConfig({ ...EMPTY, pyprojectText });
    expect(config.hasRuffConfig).toBe(true);
    expect(config.ruffTargetVersion).toBe('py311');
  });

  it('does not mistake an unrelated pyproject table for a ruff or mypy section', () => {
    const pyprojectText = '[project]\nname = "x"\ntarget-version = "py311"\n';
    const config = parsePythonProjectConfig({ ...EMPTY, pyprojectText });
    expect(config.hasRuffConfig).toBe(false);
    expect(config.ruffTargetVersion).toBeUndefined();
  });

  it('treats a standalone ruff.toml as configured even with no target-version', () => {
    const ruffConfigText = 'line-length = 100\n\n[lint]\nextend-select = ["S"]\n';
    const config = parsePythonProjectConfig({ ...EMPTY, ruffConfigText });
    expect(config.hasRuffConfig).toBe(true);
    expect(config.ruffTargetVersion).toBeUndefined();
  });

  it('detects [tool.mypy] strict mode and python_version inside pyproject.toml', () => {
    const pyprojectText = '[tool.mypy]\nstrict = true\npython_version = "3.11"\n';
    const config = parsePythonProjectConfig({ ...EMPTY, pyprojectText });
    expect(config.hasMypyConfig).toBe(true);
    expect(config.mypyStrict).toBe(true);
    expect(config.mypyPythonVersion).toBe('3.11');
  });

  it('detects a standalone mypy.ini not in strict mode', () => {
    const mypyConfigText = '[mypy]\ndisallow_untyped_defs = True\n';
    const config = parsePythonProjectConfig({ ...EMPTY, mypyConfigText });
    expect(config.hasMypyConfig).toBe(true);
    expect(config.mypyStrict).toBe(false);
  });

  it('stops a tool section at the next heading, even one on the same table family', () => {
    const pyprojectText = '[tool.ruff]\ntarget-version = "py39"\n\n[tool.mypy]\nstrict = true\n';
    const config = parsePythonProjectConfig({ ...EMPTY, pyprojectText });
    expect(config.ruffTargetVersion).toBe('py39');
    expect(config.mypyStrict).toBe(true);
  });

  it('flags a standalone mypy.ini with two [mypy] headers, verified as the real defect against mypy 1.19.0', () => {
    const mypyConfigText =
      '[mypy]\nstrict = True\ndisallow_any_explicit = True\n\n[mypy]\nstrict = False\n';
    expect(parsePythonProjectConfig({ ...EMPTY, mypyConfigText }).mypyHasDuplicateSection).toBe(
      true
    );
  });

  it('does not flag a single [mypy] section with python_version appended after the shared lines', () => {
    const mypyConfigText =
      '[mypy]\nstrict = True\ndisallow_any_explicit = True\npython_version = 3.11\n';
    const config = parsePythonProjectConfig({ ...EMPTY, mypyConfigText });
    expect(config.mypyHasDuplicateSection).toBe(false);
    expect(config.mypyStrict).toBe(true);
  });

  it('never flags a duplicate section from pyproject.toml, which cannot have one (a TOML parse error)', () => {
    const pyprojectText = '[tool.mypy]\nstrict = true\n';
    expect(parsePythonProjectConfig({ ...EMPTY, pyprojectText }).mypyHasDuplicateSection).toBe(
      false
    );
  });
});

describe('requiresPythonFloor', () => {
  it.each([
    ['>=3.11', '3.11'],
    ['^3.11', '3.11'],
    ['~=3.11', '3.11'],
    ['>=3.11,<4.0', '3.11'],
  ])('reads the floor from %s', (spec, expected) => {
    expect(requiresPythonFloor(spec)).toBe(expected);
  });

  it('returns undefined when nothing looks like a version', () => {
    expect(requiresPythonFloor('latest')).toBeUndefined();
  });
});

describe('ruffTargetVersionToken', () => {
  it('formats a floor version as ruff expects it', () => {
    expect(ruffTargetVersionToken('3.11')).toBe('py311');
    expect(ruffTargetVersionToken('3.9')).toBe('py39');
  });
});
