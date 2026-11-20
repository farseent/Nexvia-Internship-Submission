/**
 * Type-only re-exports. Tiptap's extension packages add their commands (`setImage`,
 * `insertTable`, `setTextAlign`, ...) to the editor's types by module augmentation, which only
 * applies where those packages are part of the compilation. Re-exporting one type from each
 * brings the augmentations to every package that imports `@conote/editor`, without making
 * those packages direct dependencies of the web app.
 */
export type { ImageOptions } from '@tiptap/extension-image';
export type { TaskListOptions } from '@tiptap/extension-list';
export type { TableOptions } from '@tiptap/extension-table';
export type { TextAlignOptions } from '@tiptap/extension-text-align';
export type { StarterKitOptions } from '@tiptap/starter-kit';
export type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
