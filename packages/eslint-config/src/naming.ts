import unicorn from 'eslint-plugin-unicorn';
import type { ESLint, Linter } from 'eslint';

/** Whole-word names, own casing conventions — `docs/naming.md`. */
export const DOMAIN_WORDS: Readonly<Record<string, true>> = {
  URL: true,
  HTTP: true,
  HTTPS: true,
  DNS: true,
  SSH: true,
  TLS: true,
  IP: true,
  API: true,
  CDN: true,
  JSON: true,
  YAML: true,
  SQL: true,
  URI: true,
  UUID: true,
  CLI: true,
  ARIA: true,
};

export const naming: Linter.Config[] = [
  {
    plugins: { unicorn: unicorn as unknown as ESLint.Plugin },
    rules: {
      // The plugin renamed prevent-abbreviations to this. DOMAIN_WORDS is
      // exported so a repo extends it rather than suppressing per use.
      'unicorn/name-replacements': ['error', { allowList: { ...DOMAIN_WORDS } }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        {
          selector: 'variableLike',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        // An externally-defined shape (JSON, a third-party response) keeps
        // its own casing — nothing here controls how it was written.
        { selector: 'property', format: null },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
    },
  },
];
