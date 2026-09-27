/** One Python project found in the tracked file list — PY-2, PY-3, TYP-5. */
export interface PythonProject {
  /** The project's directory, `''` for the repo root. */
  readonly directory: string;
  /** `undefined` when no `pyproject.toml` governs this project (loose scripts). */
  readonly pyprojectPath: string | undefined;
  /** Tracked `.py` files this project owns, sorted. */
  readonly pyFiles: readonly string[];
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function isUnder(file: string, directory: string): boolean {
  return directory === '' || file === directory || file.startsWith(`${directory}/`);
}

// The deepest project directory that contains `file`, so a nested
// `pyproject.toml` in a monorepo claims its own files over an ancestor's.
function deepestOwner(file: string, directories: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const directory of directories) {
    if (isUnder(file, directory) && (best === undefined || directory.length > best.length)) {
      best = directory;
    }
  }
  return best;
}

/**
 * Groups tracked `pyproject.toml` and `.py` files into projects: one per
 * `pyproject.toml`, plus one per directory of `.py` files that no
 * `pyproject.toml` governs — a provisioning folder of loose scripts, for
 * example. Pure: no filesystem access, so it is trivial to test against a
 * plain file list.
 */
export function discoverPythonProjects(trackedFiles: readonly string[]): readonly PythonProject[] {
  const pyprojectFiles = trackedFiles.filter((path) => /(^|\/)pyproject\.toml$/.test(path));
  const pyFiles = trackedFiles.filter((path) => path.endsWith('.py'));

  const directories = pyprojectFiles.map((path) => directoryOf(path));
  const filesByDirectory = new Map<string, string[]>();
  const orphansByDirectory = new Map<string, string[]>();

  for (const directory of directories) {
    filesByDirectory.set(directory, []);
  }
  for (const file of pyFiles) {
    const owner = deepestOwner(file, directories);
    if (owner !== undefined) {
      filesByDirectory.get(owner)?.push(file);
    } else {
      const directory = directoryOf(file);
      const bucket = orphansByDirectory.get(directory) ?? [];
      bucket.push(file);
      orphansByDirectory.set(directory, bucket);
    }
  }

  const projects: PythonProject[] = [];
  for (const [index, directory] of directories.entries()) {
    projects.push({
      directory,
      pyprojectPath: pyprojectFiles[index],
      pyFiles: [...(filesByDirectory.get(directory) ?? [])].sort(),
    });
  }
  for (const [directory, files] of orphansByDirectory) {
    projects.push({ directory, pyprojectPath: undefined, pyFiles: [...files].sort() });
  }

  return projects.sort((a, b) => a.directory.localeCompare(b.directory));
}
