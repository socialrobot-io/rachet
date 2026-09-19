import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '.nx/**', 'coverage/**', 'eslint.config.js', 'drizzle.config.ts', 'migrations/**', 'examples/**', 'emails/**', 'apps/dashboard/**', '.agents/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.lint.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
);
