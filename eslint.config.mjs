import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['Docs/**', '_site/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
  {
    // The CSV parser also runs as a Node.js command.
    files: ['src/data.js'],
    languageOptions: { globals: globals.nodeBuiltin },
  },
  {
    files: ['server.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
];
