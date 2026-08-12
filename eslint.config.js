// Self-hosting: resolved through the workspace link, so this repo lints against
// its own preset before it is ever published.
import { base, pulumi, scripts, tests } from '@branchleft/eslint-config';

export default [
  ...base,
  ...pulumi,
  ...scripts,
  ...tests,
  { ignores: ['**/dist/**', 'node_modules'] },
];
