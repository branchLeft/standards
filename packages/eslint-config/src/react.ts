import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import type { ESLint, Linter } from 'eslint';

/**
 * Pull a plugin's recommended rules without depending on which config key it
 * publishes them under. jsx-a11y moved from `configs` to `flatConfigs` and
 * react-hooks renamed `recommended` to `recommended-latest`; reading the rules
 * directly survives both, where spreading an exported config object does not.
 */
function recommendedRules(plugin: {
  readonly configs?: Record<string, { readonly rules?: Linter.RulesRecord }>;
  readonly flatConfigs?: Record<string, { readonly rules?: Linter.RulesRecord }>;
}): Linter.RulesRecord {
  const candidates = [
    plugin.flatConfigs?.['recommended'],
    plugin.configs?.['recommended-latest'],
    plugin.configs?.['recommended'],
  ];
  return candidates.find((c) => c?.rules)?.rules ?? {};
}

/**
 * Shared React rules for both applications and libraries.
 *
 * `jsx-a11y` is included rather than left to the axe assertions: it catches the
 * static mistakes (a missing alt, a click handler on a div, a label with no
 * control) at edit time, where axe only catches them once something renders the
 * component. The two are complementary — see `docs/stacks/react-app.md` APP-4.
 */
export const react: Linter.Config[] = [
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      'jsx-a11y': jsxA11y as unknown as ESLint.Plugin,
      'react-hooks': reactHooks as unknown as ESLint.Plugin,
    },
    rules: {
      ...recommendedRules(jsxA11y),
      ...recommendedRules(reactHooks),
      // Native semantics first (LIB-5): reach for the element that already has
      // the behaviour before reaching for ARIA.
      'jsx-a11y/no-redundant-roles': 'error',
    },
  },
];
