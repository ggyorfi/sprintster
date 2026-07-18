import { useState } from 'react';
import { CodeEditor } from './CodeEditor.js';

export default { title: 'UI/CodeEditor' };

export const Json = () => {
  const [v, setV] = useState('{\n  "hello": "world",\n  "count": 3\n}');
  return <CodeEditor label="Snippet" value={v} onChange={setV} language="json" />;
};

export const Markdown = () => {
  const [v, setV] = useState('# Title\n\nSome **bold** and _italic_ text.');
  return <CodeEditor label="Body (source)" value={v} onChange={setV} language="markdown" />;
};

export const Plaintext = () => {
  const [v, setV] = useState('plain text\nno syntax highlighting');
  return <CodeEditor label="Text" value={v} onChange={setV} />;
};
