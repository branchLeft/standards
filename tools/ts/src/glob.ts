// Glob matching for `.standardsignore`, kept as a free-standing module (rather
// than a class) because it is a pure function with no state and no
// dependency to inject — `ARCH-5` groups such helpers under a namespace
// import instead of leaving them loose.

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

/**
 * True when `path` matches `glob`, with the same semantics as
 * `ratchet_glob_matches`: a doubled `**` collapses to a single `*` first, and
 * `*` then matches across `/` — a shell `case` pattern, not a pathname
 * expansion.
 */
export function matches(glob: string, path: string): boolean {
  const collapsed = glob.replace(/\*\*/g, '*');
  const pattern = collapsed.replace(REGEX_SPECIAL, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`).test(path);
}
