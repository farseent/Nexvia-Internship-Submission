import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Module boundaries (docs/ARCHITECTURE.md §5):
 *   shared -> nothing in the repo, no I/O
 *   db, editor -> shared
 *   api -> shared, db
 *   collab -> shared, db, editor (D58: seeds Yjs documents with the editor's own schema)
 *   web -> shared, editor
 * Apps never import other apps; web never imports db.
 */
const ALL_WORKSPACE = [
  '@conote/shared',
  '@conote/db',
  '@conote/editor',
  '@conote/api',
  '@conote/collab',
  '@conote/web',
];

const DIRS = ['web', 'api', 'collab', 'db', 'editor', 'shared'];

function forbid(allowed, extra = [], own = '') {
  const forbiddenPackages = ALL_WORKSPACE.filter((name) => !allowed.includes(name));
  const byName = forbiddenPackages
    .flatMap((name) => [name, `${name}/*`])
    .map((name) => ({
      group: [name],
      message: `Module boundary violation: this package must not import ${name} (docs/ARCHITECTURE.md §5).`,
    }));
  // Reaching into another workspace package by relative path is also forbidden.
  const byRelativePath = DIRS.filter((d) => d !== own).map((d) => ({
    group: [`../**/${d}/**`],
    message: 'Import workspace packages by name (@conote/*), never by relative path.',
  }));
  return {
    'no-restricted-imports': ['error', { patterns: [...byName, ...byRelativePath, ...extra] }],
  };
}

const IO_MODULES = [
  'node:*',
  'fs',
  'fs/*',
  'path',
  'os',
  'net',
  'http',
  'https',
  'child_process',
  'crypto',
  'stream',
  'pg',
  'ioredis',
  'pino',
  'fastify',
  '@prisma/*',
  'next',
  'next/*',
  'react',
  'react-dom',
].map((group) => ({
  group: [group],
  message: 'packages/shared must stay pure: no I/O or framework imports.',
}));

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'packages/db/src/generated/**',
      'docs/**',
      'spikes/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  // --- Module boundaries ---
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...ALL_WORKSPACE.map((n) => ({
              group: [n, `${n}/*`],
              message:
                'packages/shared must not import other workspace packages (docs/ARCHITECTURE.md §5).',
            })),
            ...IO_MODULES,
          ],
        },
      ],
    },
  },
  {
    files: ['packages/db/**/*.ts'],
    ignores: ['packages/db/src/generated/**'],
    rules: forbid(['@conote/shared', '@conote/db'], [], 'db'),
  },
  {
    files: ['packages/editor/**/*.ts', 'packages/editor/**/*.tsx'],
    rules: forbid(['@conote/shared', '@conote/editor'], [], 'editor'),
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: forbid(['@conote/shared', '@conote/db', '@conote/api'], [], 'api'),
  },
  {
    files: ['apps/collab/**/*.ts'],
    rules: forbid(
      ['@conote/shared', '@conote/db', '@conote/editor', '@conote/collab'],
      [],
      'collab',
    ),
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    settings: { next: { rootDir: 'apps/web' } },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      ...forbid(
        ['@conote/shared', '@conote/editor', '@conote/web'],
        ['@prisma/*', 'pg', 'ioredis', 'fastify', '@hocuspocus/server'].map((g) => ({
          group: [g],
          message: 'apps/web must not use server-side infrastructure libraries directly.',
        })),
        'web',
      ),
    },
  },
  // Config and script files
  {
    files: ['**/*.config.{js,mjs,ts}', 'scripts/**/*.{js,mjs,ts}'],
    rules: { 'no-console': 'off' },
  },
);
