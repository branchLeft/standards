// These plugins ship no type declarations. Declaring them narrowly — rather
// than reaching for `any` — keeps the shape we actually depend on visible, so a
// breaking change upstream surfaces as a type error here instead of as a
// mis-shaped config at a consumer's lint run.

declare module 'eslint-plugin-jsx-a11y' {
  import type { Linter } from 'eslint';
  const plugin: {
    readonly rules: Record<string, unknown>;
    readonly configs?: Record<string, { readonly rules?: Linter.RulesRecord }>;
    readonly flatConfigs?: Record<string, { readonly rules?: Linter.RulesRecord }>;
  };
  export default plugin;
}

declare module 'eslint-plugin-react-hooks' {
  import type { Linter } from 'eslint';
  const plugin: {
    readonly rules: Record<string, unknown>;
    readonly configs?: Record<string, { readonly rules?: Linter.RulesRecord }>;
  };
  export default plugin;
}

declare module 'eslint-config-prettier' {
  import type { Linter } from 'eslint';
  const config: { readonly rules: Linter.RulesRecord };
  export default config;
}
