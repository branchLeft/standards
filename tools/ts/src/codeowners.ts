// Who owns a path under a CODEOWNERS file. Why a reader of its own: codeowners.md.

const OWNER_PATTERN = /^(@[\w.-]+(\/[\w.-]+)?|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

interface Rule {
  readonly regex: RegExp;
  readonly owners: readonly string[];
}

function translate(body: string): string {
  let out = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body.charAt(index);
    if (char === '*' && body.startsWith('**/', index)) {
      out += '(?:.*/)?';
      index += 2;
    } else if (char === '*' && body.charAt(index + 1) === '*') {
      out += '.*';
      index += 1;
    } else if (char === '*') {
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return out;
}

function patternToRegExp(pattern: string): RegExp {
  const directoryOnly = pattern.endsWith('/');
  const body = pattern.replace(/^\//, '').replace(/\/$/, '');
  const anchored = pattern.startsWith('/') || body.includes('/');
  const prefix = anchored ? '^' : '(?:^|.*/)';
  const suffix = directoryOnly ? '/.*$' : '(?:/.*)?$';
  return new RegExp(`${prefix}${translate(body)}${suffix}`);
}

function parseRule(line: string): Rule | undefined {
  const content = line.replace(/(^|\s)#.*$/, '').trim();
  // A section header (`[Docs]`, `^[Docs]`) names no path.
  if (content === '' || /^\^?\[/.test(content)) {
    return undefined;
  }
  const [pattern = '', ...tokens] = content.split(/\s+/);
  return { regex: patternToRegExp(pattern), owners: tokens.filter((t) => OWNER_PATTERN.test(t)) };
}

/**
 * The owners of `path`: those on the last line whose pattern matches, because
 * GitHub applies the last matching pattern. A last match that names no owner
 * releases the path, so the answer is empty then, as it is for no match.
 */
export function ownersOf(codeowners: string, path: string): readonly string[] {
  let owners: readonly string[] = [];
  for (const line of codeowners.split('\n')) {
    const rule = parseRule(line);
    if (rule?.regex.test(path)) {
      owners = rule.owners;
    }
  }
  return owners;
}
