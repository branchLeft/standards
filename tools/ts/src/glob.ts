// Glob matching for `.standardsignore`. Why a free-standing module: glob.md.

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g;

/**
 * True when `path` matches `glob`, with the same semantics as
 * `ratchet_glob_matches`: a doubled `**` collapses to a single `*` first, and
 * `*` then matches across `/` — a shell `case` pattern, not a pathname
 * expansion.
 */
export function matches(glob: string, path: string): boolean {
  const collapsed = collapse(glob);
  const pattern = collapsed.replace(REGEX_SPECIAL, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`).test(path);
}

/** `**` collapses to `*` — the two spellings are one wildcard: check-raw-sql.md. */
export function collapse(glob: string): string {
  return glob.replace(/\*\*/g, '*');
}

/**
 * A DB-1 scope-declaration line (`.standards-db-tooling`) that grants no
 * legitimate declaration. Returns the reason if `glob` must be refused, or
 * `undefined` if it is fine. A faithful port of
 * `ratchet_db_tooling_refused_reason`: tools/lib/ratchet.sh, check-raw-sql.md.
 */
export function databaseToolingRefusedReason(glob: string): string | undefined {
  const segments = collapse(glob).split('/');
  const literal = segments.some((segment) => segment !== '*');
  if (!literal) {
    return 'a catch-all with no literal path segment';
  }
  if (segments.length === 2 && segments[1] === '*' && segments[0] !== '') {
    return 'a bare top-level directory wildcard, which covers a whole source root';
  }
  return undefined;
}
