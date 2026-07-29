import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_ASSET_BYTES } from '@sprintster/engine';
import { ImageField, parseImageValue } from './ImageField.js';
import { pngFile, pngFileOfSize, pdfFile } from '../test-files.js';

const uploaded = { hash: 'd4', filename: 'hero.png', contentType: 'image/png', size: 30 };
const assetUrl = (h: string): string => `/assets/${h}`;

function makeUpload() {
  return vi.fn(async (_file: File) => uploaded);
}

describe('ImageField', () => {
  it('shows an upload control and no preview when empty', () => {
    render(<ImageField label="Hero" value="" onChange={() => {}} upload={makeUpload()} assetUrl={assetUrl} />);
    expect(screen.getByText('Hero')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/Upload image/)).toBeInTheDocument();
  });

  it('uploads a selected file and emits the image reference JSON', async () => {
    const onChange = vi.fn();
    const upload = makeUpload();
    const { container } = render(<ImageField label="Hero" value="" onChange={onChange} upload={upload} assetUrl={assetUrl} />);
    const file = pngFile();
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    expect(upload).toHaveBeenCalledWith(file);
    expect(onChange).toHaveBeenCalledWith(JSON.stringify(uploaded));
  });

  it('renders a preview and filename for an existing value', () => {
    render(
      <ImageField label="Hero" value={JSON.stringify({ ...uploaded, alt: 'Sun' })} onChange={() => {}} upload={makeUpload()} assetUrl={assetUrl} />,
    );
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/assets/d4');
    expect(img).toHaveAttribute('alt', 'Sun');
    expect(screen.getByText('hero.png')).toBeInTheDocument();
  });

  it('clears the value when Remove is clicked', async () => {
    const onChange = vi.fn();
    render(<ImageField label="Hero" value={JSON.stringify(uploaded)} onChange={onChange} upload={makeUpload()} assetUrl={assetUrl} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('edits alt text into the image value', async () => {
    const onChange = vi.fn();
    render(<ImageField label="Hero" value={JSON.stringify(uploaded)} onChange={onChange} upload={makeUpload()} assetUrl={assetUrl} />);
    await userEvent.type(screen.getByLabelText('Alt text'), 'X');
    expect(onChange).toHaveBeenCalledWith(JSON.stringify({ ...uploaded, alt: 'X' }));
  });

  it('hides upload and remove controls in read-only mode but keeps the preview', () => {
    render(
      <ImageField label="Hero" value={JSON.stringify({ ...uploaded, alt: 'Sun' })} onChange={() => {}} upload={makeUpload()} assetUrl={assetUrl} readOnly />,
    );
    expect(screen.queryByText(/Upload|Replace/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
});

describe('parseImageValue', () => {
  it('parses a valid JSON image object', () => {
    expect(parseImageValue(JSON.stringify(uploaded))).toEqual(uploaded);
  });

  it('returns null for empty or invalid input', () => {
    expect(parseImageValue('')).toBeNull();
    expect(parseImageValue('not json')).toBeNull();
    expect(parseImageValue('123')).toBeNull();
  });
});

describe('ImageField failure cases', () => {
  it('refuses an over-size file without sending it', async () => {
    const upload = makeUpload();
    const { container } = render(
      <ImageField label="Hero" value="" onChange={() => {}} upload={upload} assetUrl={assetUrl} />,
    );
    const big = pngFileOfSize(MAX_ASSET_BYTES + 1);
    await userEvent.upload(container.querySelector('input[type=file]')!, big);
    expect(screen.getByRole('alert')).toHaveTextContent(/over the 10 MB limit/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a wrong file type without sending it', async () => {
    const upload = makeUpload();
    const { container } = render(
      <ImageField label="Hero" value="" onChange={() => {}} upload={upload} assetUrl={assetUrl} />,
    );
    const pdf = pdfFile();
    // applyAccept: false, because the point is to test our check rather than the browser's accept filter.
    await userEvent.upload(container.querySelector('input[type=file]')!, pdf, { applyAccept: false });
    expect(screen.getByRole('alert')).toHaveTextContent(/unrecognised image data/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('marks the preview when the blob has gone', () => {
    const { container } = render(
      <ImageField label="Hero" value={JSON.stringify(uploaded)} onChange={() => {}} upload={makeUpload()} assetUrl={assetUrl} />,
    );
    const img = container.querySelector('img')!;
    expect(img.hasAttribute('data-missing')).toBe(false);
    fireEvent.error(img);
    expect(img.getAttribute('data-missing')).toBe('true');
  });
});
