import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['.next/**', 'drizzle/**', 'node_modules/**', 'public/sw.js', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // O domínio é puro: sem IO, sem framework, sem banco.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@/server/*', '@/app/*', 'next/*', 'drizzle-orm*', 'pg', 'pluggy-sdk'] }],
    },
  },
  { files: ['scripts/**/*.ts'], rules: { 'no-console': 'off' } },
];
