import { FlatCompat } from '@eslint/eslintrc';
import { defineConfig, globalIgnores } from 'eslint/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname
});

export default defineConfig([
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // The inherited codebase (from DoFirst, MIT) uses `any` and loose typing
      // pervasively. Relaxed here in Phase 2 to establish a clean baseline.
      // Tighten these rules again during Phase 10 hardening.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react/no-unescaped-entities': 'warn'
    }
  },
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/dist/**',
    '**/coverage/**',
    '**/*.test.ts',
    '**/*.test.tsx'
  ])
]);
