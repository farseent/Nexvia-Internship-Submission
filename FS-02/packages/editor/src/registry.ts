import type { Extensions } from '@tiptap/core';
import {
  coreExtensions,
  imageExtensions,
  placeholderExtensions,
  tableExtensions,
  taskListExtensions,
  textAlignExtensions,
  type BaseExtensionOptions,
} from './extensions.js';
import { SlashCommand, type SlashMenuRender } from './slash-command-extension.js';
import {
  BASE_SLASH_COMMANDS,
  IMAGE_SLASH_COMMAND,
  TABLE_SLASH_COMMAND,
  TASK_LIST_SLASH_COMMAND,
  type SlashCommandDefinition,
  type SlashCommandHost,
} from './slash-commands.js';

/** A unit of editor capability: Tiptap extensions plus the slash commands that expose them. */
export interface EditorFeature {
  id: string;
  extensions: Extensions;
  slashCommands?: readonly SlashCommandDefinition[];
}

/**
 * The set of features an editor is built from (FR-ED-09). New features are registered here
 * without touching the core ones. A feature that adds nodes or marks changes the persisted
 * document format: bump `EDITOR_SCHEMA_VERSION` and extend `validateEditorDocument` in
 * `@conote/shared`, otherwise the API rejects the new content.
 */
export class ExtensionRegistry {
  private readonly features = new Map<string, EditorFeature>();

  register(feature: EditorFeature): this {
    if (this.features.has(feature.id)) {
      throw new Error(`Editor feature "${feature.id}" is already registered.`);
    }
    this.features.set(feature.id, feature);
    return this;
  }

  unregister(id: string): boolean {
    return this.features.delete(id);
  }

  has(id: string): boolean {
    return this.features.has(id);
  }

  ids(): string[] {
    return [...this.features.keys()];
  }

  /** Extensions of all features, in registration order. */
  extensions(): Extensions {
    return [...this.features.values()].flatMap((feature) => feature.extensions);
  }

  slashCommands(): SlashCommandDefinition[] {
    return [...this.features.values()].flatMap((feature) => feature.slashCommands ?? []);
  }
}

/** The features of the approved Phase 4 editor. */
export function createDefaultRegistry(options: BaseExtensionOptions = {}): ExtensionRegistry {
  return new ExtensionRegistry()
    .register({
      id: 'core',
      extensions: coreExtensions(options),
      slashCommands: BASE_SLASH_COMMANDS,
    })
    .register({
      id: 'task-list',
      extensions: taskListExtensions(),
      slashCommands: [TASK_LIST_SLASH_COMMAND],
    })
    .register({ id: 'table', extensions: tableExtensions(), slashCommands: [TABLE_SLASH_COMMAND] })
    .register({ id: 'text-align', extensions: textAlignExtensions() })
    .register({ id: 'image', extensions: imageExtensions(), slashCommands: [IMAGE_SLASH_COMMAND] })
    .register({
      id: 'placeholder',
      extensions: placeholderExtensions(options.placeholder ?? "Type '/' for commands…"),
    });
}

export interface EditorExtensionOptions {
  host?: SlashCommandHost;
  /** Renderer of the slash menu; without it the commands exist but no menu is shown. */
  renderSlashMenu?: SlashMenuRender;
}

/** Everything `useEditor` needs: the registry's extensions plus the slash command menu. */
export function createEditorExtensions(
  registry: ExtensionRegistry,
  options: EditorExtensionOptions = {},
): Extensions {
  return [
    ...registry.extensions(),
    SlashCommand.configure({
      commands: registry.slashCommands(),
      host: options.host ?? {},
      render: options.renderSlashMenu,
    }),
  ];
}
