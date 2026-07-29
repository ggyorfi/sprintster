import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_ASSET_BYTES } from '@sprintster/engine';
import { MarkdownEditor } from './MarkdownEditor.js';
import { pngFile, pngFileOfSize, svgFile } from '../test-files.js';

const uploaded = { hash: 'd4', filename: 'hero.png', contentType: 'image/png', size: 30 };

const imageFile = () => pngFile();

// jsdom has no DataTransfer, and the handlers only read .files off the event.
function transferEvent(type: 'paste' | 'drop', files: File[]): Event {
  const event =
    type === 'drop'
      ? new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 })
      : new Event('paste', { bubbles: true, cancelable: true });
  const data = { files, items: [], types: ['Files'], getData: () => '' };
  Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: data });
  return event;
}

const paste = (target: Element, files: File[]) => fireEvent(target, transferEvent('paste', files));
const drop = (target: Element, files: File[]) => fireEvent(target, transferEvent('drop', files));

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
    const file = pngFile();
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
    const file = pngFile();
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
    const file = pngFile();
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    expect(await screen.findByRole('alert')).toHaveTextContent('upload failed (500)');
    expect(onChange.mock.calls.flat().join('')).not.toContain('![');
  });

  it('selects a freshly inserted image, so its alt field is there to fill in', async () => {
    const { container } = render(
      <MarkdownEditor value={'Intro\n\nOutro'} onChange={() => {}} upload={async () => uploaded} />,
    );
    const file = pngFile();
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    expect(await screen.findByLabelText('Alt text')).toHaveValue('');
  });

  it('describes a freshly inserted image without leaving the editor', async () => {
    let latest = '';
    const { container } = render(
      <MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} upload={async () => uploaded} />,
    );
    const file = pngFile();
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    await userEvent.type(await screen.findByLabelText('Alt text'), 'Sunset');
    await waitFor(() => expect(latest).toContain('Sunset'));
    expect(latest).toContain('![Sunset](/assets/d4)');
  });

  it('offers no alt text field until an image is selected', () => {
    render(<MarkdownEditor value={'just prose'} onChange={() => {}} />);
    expect(screen.queryByLabelText('Alt text')).toBeNull();
  });

  it('shows the alt text of the selected image', () => {
    render(<MarkdownEditor value={'![A blue cover](/assets/d4)'} onChange={() => {}} />);
    expect(screen.getByLabelText('Alt text')).toHaveValue('A blue cover');
  });

  it('writes edited alt text into the markdown', async () => {
    let latest = '';
    render(<MarkdownEditor value={'![](/assets/d4)'} onChange={(v) => (latest = v)} />);
    await userEvent.type(screen.getByLabelText('Alt text'), 'Sunset');
    await waitFor(() => expect(latest).toContain('Sunset'));
    expect(latest).toContain('![Sunset](/assets/d4)');
  });

  it('round-trips alt text through a reload', async () => {
    let latest = '';
    const { unmount } = render(<MarkdownEditor value={'![](/assets/d4)'} onChange={(v) => (latest = v)} />);
    await userEvent.type(screen.getByLabelText('Alt text'), 'Sunset');
    await waitFor(() => expect(latest).toContain('Sunset'));
    unmount();

    render(<MarkdownEditor value={latest} onChange={() => {}} />);
    expect(screen.getByLabelText('Alt text')).toHaveValue('Sunset');
  });

  it('uploads a pasted image and inserts the same markdown as the toolbar path', async () => {
    let latest = '';
    const upload = vi.fn(async (_file: File) => uploaded);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} upload={upload} />);
    paste(container.querySelector('.ProseMirror')!, [imageFile()]);
    await waitFor(() => expect(latest).toContain('!['));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(latest).toContain('![](/assets/d4)');
  });

  it('uploads a dropped image', async () => {
    let latest = '';
    const { container } = render(
      <MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} upload={async () => uploaded} />,
    );
    drop(container.querySelector('.ProseMirror')!, [imageFile()]);
    await waitFor(() => expect(latest).toContain('!['));
    expect(latest).toContain('![](/assets/d4)');
  });

  it('leaves a non-image paste to the editor', async () => {
    const upload = vi.fn(async (_file: File) => uploaded);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={() => {}} upload={upload} />);
    paste(container.querySelector('.ProseMirror')!, [new File(['plain'], 'notes.txt', { type: 'text/plain' })]);
    expect(upload).not.toHaveBeenCalled();
  });

  it('pastes the same image twice and references one blob', async () => {
    let latest = '';
    const { container } = render(
      <MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} upload={async () => uploaded} />,
    );
    const box = container.querySelector('.ProseMirror')!;
    paste(box, [imageFile()]);
    await waitFor(() => expect(latest).toContain('!['));
    paste(box, [imageFile()]);
    await waitFor(() => expect(latest.match(/!\[]\(/g)?.length).toBe(2));
    expect(latest.match(/\/assets\/d4/g)).toHaveLength(2);
  });

  it('refuses an over-size file without sending it', async () => {
    const upload = vi.fn(async (_file: File) => uploaded);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={() => {}} upload={upload} />);
    const big = pngFileOfSize(MAX_ASSET_BYTES + 1);
    await userEvent.upload(container.querySelector('input[type=file]')!, big);
    expect(await screen.findByRole('alert')).toHaveTextContent(/over the 10 MB limit/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a wrong file type without sending it', async () => {
    const upload = vi.fn(async (_file: File) => uploaded);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={() => {}} upload={upload} />);
    paste(container.querySelector('.ProseMirror')!, [svgFile()]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/SVG is not accepted/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('marks an image whose blob has gone, instead of leaving a broken icon', async () => {
    const { container } = render(<MarkdownEditor value={'![Gone](/assets/missing)'} onChange={() => {}} />);
    const img = container.querySelector('img')!;
    expect(img.hasAttribute('data-missing')).toBe(false);
    fireEvent.error(img);
    await waitFor(() => expect(img.getAttribute('data-missing')).toBe('true'));
  });

  it('is not editable in read-only mode and hides the toolbar (preview reuse)', () => {
    const { container } = render(<MarkdownEditor value={'plain text'} onChange={() => {}} readOnly />);
    expect(container.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
  });
});
