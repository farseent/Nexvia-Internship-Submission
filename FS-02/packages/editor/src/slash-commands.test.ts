import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from './registry.js';
import { filterSlashCommands } from './slash-commands.js';

const commands = createDefaultRegistry().slashCommands();
const ids = (query: string, host = { requestImage: () => undefined }) =>
  filterSlashCommands(commands, query, host).map((c) => c.id);

describe('filterSlashCommands', () => {
  it('lists every command for an empty query, in menu order', () => {
    expect(ids('')).toEqual([
      'paragraph',
      'heading-1',
      'heading-2',
      'heading-3',
      'bullet-list',
      'ordered-list',
      'task-list',
      'table',
      'image',
    ]);
  });

  it('matches title prefixes first, then keywords', () => {
    expect(ids('head')).toEqual(['heading-1', 'heading-2', 'heading-3']);
    expect(ids('todo')).toEqual(['task-list']);
    expect(ids('h2')).toEqual(['heading-2']);
  });

  it('is case-insensitive and trims', () => {
    expect(ids('  TABLE ')).toEqual(['table']);
  });

  it('matches inside words and returns nothing for unknown text', () => {
    expect(ids('list')).toEqual(
      expect.arrayContaining(['bullet-list', 'ordered-list', 'task-list']),
    );
    expect(ids('zzzz')).toEqual([]);
  });

  it('hides the image command when the host cannot upload', () => {
    expect(filterSlashCommands(commands, '', {}).map((c) => c.id)).not.toContain('image');
    expect(filterSlashCommands(commands, 'image', {})).toEqual([]);
  });
});
