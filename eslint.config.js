// Pragmatic flat config: catch real bugs (no-undef, unused, unsafe patterns)
// without fighting the existing style. Tighten rules as the codebase settles.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'backend/**', 'finetuning/**', 'hermes/**', 'workdaemon-brain/**', 'workdaemon-daemons/**', 'docs/**', 'public/**'] },

  // Server (Vercel functions) + scripts — Node ESM.
  {
    files: ['api/**/*.js', 'scripts/**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',        // security.js strips control chars by design
      'no-useless-assignment': 'off',   // defensive `let x = ''` init style is intentional here
    },
  },

  // Frontend — browser JSX.
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'off',
      // react-hooks v7 compiler-derived rules: too noisy on the existing
      // load-on-mount patterns. Re-enable when the Dashboard split settles.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
    },
  },
];
