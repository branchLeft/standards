/** One `KEY=value` (or legacy `KEY value`) pair from an `ENV` instruction's arguments. */
export interface EnvironmentPair {
  readonly key: string;
  readonly value: string;
}

function splitRespectingQuotes(text: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (const char of text) {
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (/\s/.test(char) && !inSingle && !inDouble) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current !== '') {
    tokens.push(current);
  }
  return tokens;
}

/** Docker supports `ENV KEY value` (one pair) and `ENV KEY1=v1 KEY2=v2` (many). */
export function parseEnvironmentArguments(
  instructionArguments: string
): readonly EnvironmentPair[] {
  if (!instructionArguments.includes('=')) {
    const spaceIndex = instructionArguments.search(/\s/);
    if (spaceIndex === -1) {
      return [];
    }
    return [
      {
        key: instructionArguments.slice(0, spaceIndex),
        value: instructionArguments.slice(spaceIndex + 1).trim(),
      },
    ];
  }
  const pairs: EnvironmentPair[] = [];
  for (const token of splitRespectingQuotes(instructionArguments)) {
    const equalsIndex = token.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }
    pairs.push({ key: token.slice(0, equalsIndex), value: token.slice(equalsIndex + 1) });
  }
  return pairs;
}
