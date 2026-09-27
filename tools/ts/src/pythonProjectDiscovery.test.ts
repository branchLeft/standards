import { describe, expect, it } from 'vitest';
import { discoverPythonProjects } from './pythonProjectDiscovery.ts';

describe('discoverPythonProjects', () => {
  it('reports nothing for a repo with no Python at all', () => {
    expect(discoverPythonProjects(['README.md', 'src/index.ts'])).toEqual([]);
  });

  it('groups a single pyproject.toml project with its .py files', () => {
    const projects = discoverPythonProjects([
      'pyproject.toml',
      'src/app.py',
      'src/util.py',
      'README.md',
    ]);
    expect(projects).toEqual([
      {
        directory: '',
        pyprojectPath: 'pyproject.toml',
        pyFiles: ['src/app.py', 'src/util.py'],
      },
    ]);
  });

  it('groups loose scripts with no pyproject.toml into one project per directory', () => {
    const projects = discoverPythonProjects([
      'provision/setup_host.py',
      'provision/test_setup_host.py',
      'other/tool.py',
    ]);
    expect(projects).toEqual([
      {
        directory: 'other',
        pyprojectPath: undefined,
        pyFiles: ['other/tool.py'],
      },
      {
        directory: 'provision',
        pyprojectPath: undefined,
        pyFiles: ['provision/setup_host.py', 'provision/test_setup_host.py'],
      },
    ]);
  });

  it('gives a nested pyproject.toml its own files over an ancestor project', () => {
    const projects = discoverPythonProjects([
      'pyproject.toml',
      'services/worker/pyproject.toml',
      'services/worker/main.py',
      'lib.py',
    ]);
    const byDirectory = new Map(projects.map((project) => [project.directory, project]));
    expect(byDirectory.get('')?.pyFiles).toEqual(['lib.py']);
    expect(byDirectory.get('services/worker')?.pyFiles).toEqual(['services/worker/main.py']);
  });

  it('treats a repo-root pyproject.toml with no tracked .py files as an empty project', () => {
    expect(discoverPythonProjects(['pyproject.toml'])).toEqual([
      { directory: '', pyprojectPath: 'pyproject.toml', pyFiles: [] },
    ]);
  });
});
