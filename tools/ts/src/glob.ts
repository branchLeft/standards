// Glob matching for `.standardsignore`. Why a free-standing module: glob.md.

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
