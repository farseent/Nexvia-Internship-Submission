import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * Deliberate violations: prove the module-boundary lint rules actually fire
 * (docs/ARCHITECTURE.md §5). Each case lints in-memory source as if it lived at `file`.
 */
const eslint = new ESLint({ cwd: process.cwd() });

async function lint(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: file });
  return result?.messages.filter((m) => m.ruleId === 'no-restricted-imports') ?? [];
}

const violations: [string, string, string][] = [
  [
    'web must not import db',
    'apps/web/src/x.ts',
    "import { createPrismaClient } from '@conote/db';\nvoid createPrismaClient;\n",
  ],
  ['web must not import api', 'apps/web/src/x.ts', "import '@conote/api';\n"],
  ['web must not import collab', 'apps/web/src/x.ts', "import '@conote/collab';\n"],
  ['web must not use prisma directly', 'apps/web/src/x.ts', "import '@prisma/client';\n"],
  ['api must not import collab', 'apps/api/src/x.ts', "import '@conote/collab';\n"],
  ['api must not import web', 'apps/api/src/x.ts', "import '@conote/web';\n"],
  ['collab must not import api', 'apps/collab/src/x.ts', "import '@conote/api';\n"],
  ['editor must not import collab', 'packages/editor/src/x.ts', "import '@conote/collab';\n"],
  ['api must not import editor', 'apps/api/src/x.ts', "import '@conote/editor';\n"],
  ['db must not import api', 'packages/db/src/x.ts', "import '@conote/api';\n"],
  ['editor must not import db', 'packages/editor/src/x.ts', "import '@conote/db';\n"],
  ['shared must not import db', 'packages/shared/src/x.ts', "import '@conote/db';\n"],
  ['shared must not import node builtins', 'packages/shared/src/x.ts', "import 'node:fs';\n"],
  ['shared must not import pino', 'packages/shared/src/x.ts', "import 'pino';\n"],
  ['relative import across workspaces', 'apps/api/src/x.ts', "import '../../web/src/env';\n"],
];

const allowed: [string, string, string][] = [
  [
    'api may import shared and db',
    'apps/api/src/x.ts',
    "import '@conote/shared';\nimport '@conote/db';\n",
  ],
  [
    'collab may import shared and db',
    'apps/collab/src/x.ts',
    "import '@conote/shared';\nimport '@conote/db';\n",
  ],
  ['collab may import editor (D58)', 'apps/collab/src/x.ts', "import '@conote/editor';\n"],
  ['web may import shared', 'apps/web/src/x.ts', "import '@conote/shared';\n"],
  ['db may import shared', 'packages/db/src/x.ts', "import '@conote/shared';\n"],
];

describe('module boundaries', { timeout: 30_000 }, () => {
  it.each(violations)('%s', async (_name, file, code) => {
    const messages = await lint(file, code);
    expect(messages.length).toBeGreaterThan(0);
  });

  it.each(allowed)('%s', async (_name, file, code) => {
    expect(await lint(file, code)).toEqual([]);
  });
});
