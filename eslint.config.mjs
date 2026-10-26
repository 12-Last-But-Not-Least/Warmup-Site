import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['_site/**', 'coverage/**'] },
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
    // Tests run under Node, with a jsdom window for the DOM tests.
    files: ['test/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['server.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
];
