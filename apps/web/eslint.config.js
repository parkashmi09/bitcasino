import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * ESLint, flat config.
 *
 * `npm run lint` has been wired since the first commit and there was nothing
 * behind it — `eslint .` with no config is an error, not a pass, so the script
 * had never once run green. This is that config.
 *
 * ## What it is for
 *
 * Not style. Prettier-shaped rules are absent on purpose: this repository's
 * formatting is already consistent and a linter that argues about quotes
 * drowns the two rules that actually catch defects.
 *
 * Those two are `react-hooks/rules-of-hooks` and
 * `react-hooks/exhaustive-deps`. A stale closure in an effect is the failure
 * mode this codebase is most exposed to — the wallet drawer, the socket
 * rebind and the token store all read values that change under a subscription
 * — and it is invisible in review and silent at runtime. Everything else here
 * is `@eslint/js`'s recommended set, which is mostly "this is definitely a
 * typo".
 *
 * ## Three deliberate deviations
 *
 * - **`no-unused-vars` allows a leading underscore** and allows unused *rest
 *   siblings*. `const {status, ...data} = reply` in `lib/socket.js` is how the
 *   envelope key is stripped, and the rule would otherwise demand the file be
 *   rewritten to satisfy a linter.
 * - **`no-empty` allows an empty `catch`.** There are several, every one of
 *   them commented with why the failure is not actionable — `localStorage` in
 *   private mode, a rebind that leaves the socket in the state it was already
 *   in. A rule that forced a `void 0` into each would make them less clear,
 *   not safer.
 * - **`react-refresh/only-export-components` is a warning**, and scoped to
 *   `.jsx`. It guards fast refresh, which is a development convenience; a
 *   file that exports a component and a constant beside it still builds and
 *   still ships.
 */
export default [
  {
    // `dist` is build output and `coverage` is a report. Neither is source,
    // and linting either produces thousands of findings about generated code.
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,

  {
    // The app, and the two Node scripts beside it — same language level, the
    // globals differ and are set per-block below.
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        // JSX is parsed everywhere rather than only in `.jsx`: `.test.jsx`
        // files render components, and the boundary is not worth two blocks.
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: {
      // A disable comment for a rule that no longer fires is dead weight and
      // hides the fact that the exception ended.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `==` against `null` is the one loose comparison worth keeping: it is
      // the shortest correct way to mean "null or undefined", which is a
      // distinction this API layer makes constantly.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      // `console.log` left in a component ships to production and prints on a
      // player's machine. `warn` and `error` are how the socket layer reports
      // something a developer needs to see, so they stay.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Browser code. `process` is not defined here — Vite replaces
    // `import.meta.env`, and reaching for `process.env` in a component is a
    // runtime ReferenceError rather than a build failure, which is exactly
    // what this catches.
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      /**
       * ONE rule from `eslint-plugin-react`, and it is not a style rule.
       *
       * Core ESLint does not know that `<Button />` reads the `Button`
       * binding, so without this every component imported for JSX and used
       * nowhere else is reported as an unused variable — 300+ findings in
       * this codebase, all of them false, which is a linter nobody will run
       * twice. `jsx-uses-vars` is the rule that teaches `no-unused-vars` to
       * count a JSX tag as a reference.
       *
       * The plugin's `recommended` set is deliberately NOT spread in. It
       * carries `react/prop-types`, which wants runtime type declarations on
       * a codebase that documents props in prose above each component, and
       * `react/react-in-jsx-scope`, which is wrong for React 19's automatic
       * runtime — the very thing that lets these files import no React at all.
       */
      'react/jsx-uses-vars': 'error',

      /**
       * ═══════════════════════════════════════════════════════════════════
       * TWO OF `react-hooks`' COMPILER-ERA RULES ARE OFF, AND NOT LIGHTLY.
       *
       * `eslint-plugin-react-hooks` v6 folded the React Compiler's own
       * analysis into `recommended`. `rules-of-hooks` and `exhaustive-deps`
       * — the two this config exists for — are unchanged. These two are new,
       * and they fire on patterns that are correct here:
       *
       * `set-state-in-effect` (17 sites) is almost entirely ONE pattern:
       * a dialog resetting its own fields when it opens.
       *
       *     useEffect(() => { if (!open) return; setFields(EMPTY); … }, [open])
       *
       * The rule's advice — derive it, or key the component — is right in
       * general and wrong for these: the fields are *edited* after the reset,
       * so they cannot be derived, and remounting on a `key` would throw away
       * the dialog's exit animation. The other sites are subscriptions to
       * something outside React (a media query, the token store), where the
       * genuine fix is `useSyncExternalStore` — which this codebase already
       * uses in the three places the shared state made it worth it.
       *
       * `purity` fires on `Date.now()` inside `validate()` in `KycDialog` —
       * a function called from the submit handler, never during render. The
       * rule cannot see the difference and flags the definition.
       *
       * Both are off HERE, in one place with the reason attached, rather than
       * as seventeen `eslint-disable-next-line` comments that say nothing.
       * Turning either back on is a refactor, not a config change.
       * ═══════════════════════════════════════════════════════════════════
       */
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },

  {
    files: ['src/**/*.jsx'],
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    // Vitest exposes nothing globally — every test imports `describe`, `it`
    // and `expect` by name — so the only extra globals here are Node's, for
    // the files that reach for `process` or `Buffer` while stubbing `fetch`.
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // A test may assert on something it does not otherwise use.
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
    },
  },

  {
    // The two verification scripts run under Node, not in a browser.
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // They report to a terminal. That is the whole point of them.
      'no-console': 'off',
    },
  },
];
