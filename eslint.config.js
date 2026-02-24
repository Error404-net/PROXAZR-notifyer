const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        process: 'readonly'
      }
    },
    rules: {
      'no-console': 'off'
    }
  }
];
