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

const WILDCARD_CHARS = /[*?[]/;

/**
 * A DB-1 scope-declaration line (`.standards-db-tooling`) that grants no
 * legitimate declaration. Returns the reason if `glob` must be refused, or
 * `undefined` if it is fine. A faithful port of
 * `ratchet_db_tooling_refused_reason`: tools/lib/ratchet.sh, check-raw-sql.md.
 */
export function databaseToolingRefusedReason(glob: string): string | undefined {
  const collapsed = collapse(glob);
  if (collapsed.endsWith('/')) {
    return 'an empty path segment';
  }
  const segments = collapsed.split('/');

  let literalBefore = 0;
  let literalTotal = 0;
  let wildcardSeen = false;
  for (const segment of segments) {
    if (segment === '') {
      return 'an empty path segment';
    }
    if (segment === '.' || segment === '..') {
      return "a '.' or '..' path segment";
    }
    if (WILDCARD_CHARS.test(segment)) {
      wildcardSeen = true;
    } else {
      literalTotal += 1;
      if (!wildcardSeen) {
        literalBefore += 1;
      }
    }
  }

  if (literalBefore === 0) {
    return 'a wildcard with no literal path segment before it';
  }
  if (wildcardSeen && literalTotal === 1) {
    return 'a bare top-level directory wildcard, which covers a whole source root';
  }
  return undefined;
}
