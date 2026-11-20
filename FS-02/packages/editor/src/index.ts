export {
  coreExtensions,
  imageExtensions,
  placeholderExtensions,
  tableExtensions,
  taskListExtensions,
  textAlignExtensions,
  type BaseExtensionOptions,
} from './extensions.js';
export {
  ExtensionRegistry,
  createDefaultRegistry,
  createEditorExtensions,
  type EditorExtensionOptions,
  type EditorFeature,
} from './registry.js';
export {
  SLASH_COMMAND_PLUGIN_KEY,
  SlashCommand,
  type SlashCommandOptions,
  type SlashMenuRender,
} from './slash-command-extension.js';
export {
  BASE_SLASH_COMMANDS,
  SLASH_TABLE_SIZE,
  filterSlashCommands,
  type SlashCommandContext,
  type SlashCommandDefinition,
  type SlashCommandHost,
} from './slash-commands.js';
export type * from './types.js';
