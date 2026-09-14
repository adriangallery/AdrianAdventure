// V8 (plan AdrianZERO): lint por fases. Fase 1 = reglas recomendadas de JS y typescript-eslint con lo ruidoso
// en «warn» para no romper nada; el CI falla solo con errores. Las dependencias de eslint se instalan en CI
// con --no-save (no tocan el lockfile ni se instalan en el portátil).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'electron/**', 'steam-build/**', 'android/**', 'trailer/**', 'audiobook/**', 'save-server/**', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
