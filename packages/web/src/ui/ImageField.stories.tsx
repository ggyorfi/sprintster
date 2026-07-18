import { useState } from 'react';
import { ImageField } from './ImageField.js';
import type { UploadedAsset } from '../api/assets.js';

export default { title: 'UI/ImageField' };

// A local stand-in for the daemon: no real upload or /assets endpoint in the workshop.
const placeholder =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='%236b7280'/><text x='32' y='37' fill='white' font-size='11' text-anchor='middle'>img</text></svg>";

const mockUpload = async (file: File): Promise<UploadedAsset> => ({
  hash: 'demo',
  filename: file.name,
  contentType: file.type === '' ? 'image/png' : file.type,
  size: file.size,
});

const assetUrl = (): string => placeholder;

export const Empty = () => {
  const [v, setV] = useState('');
  return <ImageField label="Hero" value={v} onChange={setV} upload={mockUpload} assetUrl={assetUrl} />;
};

export const WithImage = () => {
  const [v, setV] = useState(
    JSON.stringify({ hash: 'demo', filename: 'hero.png', contentType: 'image/png', size: 20481, alt: 'A demo image' }),
  );
  return <ImageField label="Hero" value={v} onChange={setV} upload={mockUpload} assetUrl={assetUrl} />;
};
