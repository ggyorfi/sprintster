import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownEditor } from './MarkdownEditor.js';

const uploaded = { hash: 'd4', filename: 'hero.png', contentType: 'image/png', size: 30 };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MarkdownEditor', () => {
  it('renders markdown formatted in place', () => {
    const { container } = render(
      <MarkdownEditor label="Body" value={'# Title\n\nHello **world**'} onChange={() => {}} />,
    );
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(container.querySelector('h1')?.textContent).toContain('Title');
    expect(container.querySelector('strong')?.textContent).toContain('world');
  });

  it('shows a formatting toolbar whose buttons reflect the active mark', async () => {
    render(<MarkdownEditor label="Body" value={'hello'} onChange={() => {}} />);
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'));
  });

  it('renders a stored markdown image', () => {
    const { container } = render(
      <MarkdownEditor value={'Intro\n\n![A blue cover](/assets/abc123)\n\nOutro'} onChange={() => {}} />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/assets/abc123');
    expect(img?.getAttribute('alt')).toBe('A blue cover');
  });

  it('keeps an existing image when unrelated text is edited', async () => {
    let latest = '';
    render(
      <MarkdownEditor value={'Intro\n\n![A blue cover](/assets/abc123)\n\nOutro'} onChange={(v) => (latest = v)} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Heading 1' }));
    await waitFor(() => expect(latest).not.toBe(''));
    expect(latest).toContain('![A blue cover](/assets/abc123)');
  });

  it('stores an asset reference root-relative even when the API base URL is a full origin', async () => {
    vi.stubEnv('VITE_API_URL', 'https://app.example.com');
    let latest = '';
    const { container } = render(
      <MarkdownEditor
        value={'Intro\n\n![A blue cover](https://app.example.com/assets/abc123)\n\nOutro'}
        onChange={(v) => (latest = v)}
      />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://app.example.com/assets/abc123');
    await userEvent.click(screen.getByRole('button', { name: 'Heading 1' }));
    await waitFor(() => expect(latest).not.toBe(''));
    expect(latest).toContain('![A blue cover](/assets/abc123)');
    expect(latest).not.toContain('app.example.com');
  });

  it('leaves a URL that is not ours untouched, including a data URL', async () => {
    let latest = '';
    render(
      <MarkdownEditor
        value={'![a](data:image/png;base64,iVBOR)\n\n![b](https://elsewhere.example/p.png)\n\nTail'}
        onChange={(v) => (latest = v)}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Heading 1' }));
    await waitFor(() => expect(latest).not.toBe(''));
    expect(latest).toContain('![a](data:image/png;base64,iVBOR)');
    expect(latest).toContain('![b](https://elsewhere.example/p.png)');
  });

  it('has no image button unless an upload function is supplied', () => {
    render(<MarkdownEditor value={'hello'} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Insert image' })).toBeNull();
  });

  it('uploads a chosen file and inserts it as root-relative markdown', async () => {
    let latest = '';
    const upload = vi.fn(async (_file: File) => uploaded);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} upload={upload} />);
    const file = new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' });
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    expect(upload).toHaveBeenCalledWith(file);
    await waitFor(() => expect(latest).toContain('!['));
    expect(latest).toContain('![](/assets/d4)');
  });

  it('inserts root-relative markdown even when the API base URL is a full origin', async () => {
    vi.stubEnv('VITE_API_URL', 'https://app.example.com');
    let latest = '';
    const { container } = render(
      <MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} upload={async () => uploaded} />,
    );
    const file = new File([new Uint8Array([1])], 'hero.png', { type: 'image/png' });
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    await waitFor(() => expect(latest).toContain('!['));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://app.example.com/assets/d4');
    expect(latest).toContain('![](/assets/d4)');
    expect(latest).not.toContain('app.example.com');
  });

  it('reports an upload failure and inserts nothing', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        value={'Intro'}
        onChange={onChange}
        upload={async () => {
          throw new Error('upload failed (500)');
        }}
      />,
    );
    const file = new File([new Uint8Array([1])], 'hero.png', { type: 'image/png' });
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    expect(await screen.findByRole('alert')).toHaveTextContent('upload failed (500)');
    expect(onChange.mock.calls.flat().join('')).not.toContain('![');
  });

  it('is not editable in read-only mode and hides the toolbar (preview reuse)', () => {
    const { container } = render(<MarkdownEditor value={'plain text'} onChange={() => {}} readOnly />);
    expect(container.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
  });
});
