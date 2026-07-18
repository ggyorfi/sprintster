import { useState } from 'react';
import { MarkdownEditor } from './MarkdownEditor.js';

export default { title: 'UI/MarkdownEditor' };

export const Default = () => {
  const [v, setV] = useState('# Hello\n\nType **markdown** and it formats in place.\n\n- one\n- two\n\n> a quote');
  return <MarkdownEditor label="Body" value={v} onChange={setV} />;
};

export const ReadOnlyPreview = () => (
  <MarkdownEditor label="Preview" value={'## Preview\n\nThis is the WYSIWYG editor in **read-only** mode.'} onChange={() => {}} readOnly />
);
