import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import {
  filterSlashCommands,
  type SlashCommandDefinition,
  type SlashCommandHost,
} from './slash-commands.js';

/** Renderer callbacks for the menu; the web app supplies a React implementation. */
export type SlashMenuRender = NonNullable<SuggestionOptions<SlashCommandDefinition>['render']>;

export interface SlashCommandOptions {
  commands: readonly SlashCommandDefinition[];
  host: SlashCommandHost;
  render: SlashMenuRender | undefined;
}

export const SLASH_COMMAND_PLUGIN_KEY = new PluginKey('slashCommand');

/**
 * Slash menu built on Tiptap's official suggestion utility (no custom ProseMirror plugin).
 * It decides which commands match and runs the chosen one; showing the menu is the host's job.
 */
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return { commands: [], host: {}, render: undefined };
  },

  addProseMirrorPlugins() {
    const { commands, host, render } = this.options;
    const editor: Editor = this.editor;
    return [
      Suggestion<SlashCommandDefinition, SlashCommandDefinition>({
        editor,
        pluginKey: SLASH_COMMAND_PLUGIN_KEY,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterSlashCommands(commands, query, host),
        command: ({
          editor: activeEditor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SlashCommandDefinition;
        }) => {
          props.run({ editor: activeEditor, range, host });
        },
        ...(render === undefined ? {} : { render }),
      }),
    ];
  },
});
