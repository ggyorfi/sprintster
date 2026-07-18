import { useState } from 'react';
import { ComboEditor } from './ComboEditor.js';

export default { title: 'UI/ComboEditor' };

export const Default = () => {
  const [v, setV] = useState('# Combo editor\n\nToggle between **Rich** and **Source** over one markdown value.');
  return <ComboEditor label="Body" value={v} onChange={setV} />;
};

export const OpensInSource = () => {
  const [v, setV] = useState('# Source first\n\nThis one opens in the source view.');
  return <ComboEditor label="Body" value={v} onChange={setV} defaultMode="source" />;
};
