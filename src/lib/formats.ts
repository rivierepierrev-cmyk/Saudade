/** Display names of document formats. */
import { DocumentItem } from '../types/saudade';

export const FORMAT_LABEL: Record<DocumentItem['format'], string> = {
  article: 'Article',
  book: 'Livre',
  pdf: 'PDF',
  markdown: 'Markdown',
  note: 'Note',
  writing: 'Écriture',
};

/** A text the user writes over time (incremental writing). */
export const isWriting = (doc: Pick<DocumentItem, 'format'>) => doc.format === 'writing';
