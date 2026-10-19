import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import base from './base.js';

/** Configuração ESLint para apps React. */
export default [
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
