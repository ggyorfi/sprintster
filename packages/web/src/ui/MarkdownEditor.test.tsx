import { describe, it, expect, vi, afterEach } from 'vitest';
import { lazy, Suspense } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_ASSET_BYTES } from '@sprintster/engine';
import { MarkdownEditor } from './MarkdownEditor.js';
import { pngFile, pngFileOfSize, svgFile } from '../test-files.js';

const attached = { id: 'a1' };

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

  it('has no image button unless an attach function is supplied', () => {
    render(<MarkdownEditor value={'hello'} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Insert image' })).toBeNull();
  });

  it('uploads a chosen file and inserts it as root-relative markdown', async () => {
    let latest = '';
    const attach = vi.fn(async (_file: File) => attached);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} attach={attach} />);
    const file = pngFile();
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    expect(attach).toHaveBeenCalledWith(file);
    await waitFor(() => expect(latest).toContain('!['));
    expect(latest).toContain('![](/assets/a1)');
  });

  it('inserts root-relative markdown even when the API base URL is a full origin', async () => {
    vi.stubEnv('VITE_API_URL', 'https://app.example.com');
    let latest = '';
    const { container } = render(
      <MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} attach={async () => attached} />,
    );
    const file = pngFile();
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    await waitFor(() => expect(latest).toContain('!['));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://app.example.com/assets/a1');
    expect(latest).toContain('![](/assets/a1)');
    expect(latest).not.toContain('app.example.com');
  });

  it('reports an upload failure and inserts nothing', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownEditor
        value={'Intro'}
        onChange={onChange}
        attach={async () => {
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
      <MarkdownEditor value={'Intro\n\nOutro'} onChange={() => {}} attach={async () => attached} />,
    );
    const file = pngFile();
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    expect(await screen.findByLabelText('Alt text')).toHaveValue('');
  });

  it('describes a freshly inserted image without leaving the editor', async () => {
    let latest = '';
    const { container } = render(
      <MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} attach={async () => attached} />,
    );
    const file = pngFile();
    await userEvent.upload(container.querySelector('input[type=file]')!, file);
    await userEvent.type(await screen.findByLabelText('Alt text'), 'Sunset');
    await waitFor(() => expect(latest).toContain('Sunset'));
    expect(latest).toContain('![Sunset](/assets/a1)');
  });

  it('offers no alt text field until an image is selected', () => {
    render(<MarkdownEditor value={'just prose'} onChange={() => {}} />);
    expect(screen.queryByLabelText('Alt text')).toBeNull();
  });

  it('shows the alt text of the selected image', () => {
    render(<MarkdownEditor value={'![A blue cover](/assets/a1)'} onChange={() => {}} />);
    expect(screen.getByLabelText('Alt text')).toHaveValue('A blue cover');
  });

  it('writes edited alt text into the markdown', async () => {
    let latest = '';
    render(<MarkdownEditor value={'![](/assets/a1)'} onChange={(v) => (latest = v)} />);
    await userEvent.type(screen.getByLabelText('Alt text'), 'Sunset');
    await waitFor(() => expect(latest).toContain('Sunset'));
    expect(latest).toContain('![Sunset](/assets/a1)');
  });

  it('round-trips alt text through a reload', async () => {
    let latest = '';
    const { unmount } = render(<MarkdownEditor value={'![](/assets/a1)'} onChange={(v) => (latest = v)} />);
    await userEvent.type(screen.getByLabelText('Alt text'), 'Sunset');
    await waitFor(() => expect(latest).toContain('Sunset'));
    unmount();

    render(<MarkdownEditor value={latest} onChange={() => {}} />);
    expect(screen.getByLabelText('Alt text')).toHaveValue('Sunset');
  });

  it('uploads a pasted image and inserts the same markdown as the toolbar path', async () => {
    let latest = '';
    const attach = vi.fn(async (_file: File) => attached);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} attach={attach} />);
    paste(container.querySelector('.ProseMirror')!, [imageFile()]);
    await waitFor(() => expect(latest).toContain('!['));
    expect(attach).toHaveBeenCalledTimes(1);
    expect(latest).toContain('![](/assets/a1)');
  });

  it('uploads a dropped image', async () => {
    let latest = '';
    const { container } = render(
      <MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} attach={async () => attached} />,
    );
    drop(container.querySelector('.ProseMirror')!, [imageFile()]);
    await waitFor(() => expect(latest).toContain('!['));
    expect(latest).toContain('![](/assets/a1)');
  });

  it('leaves a non-image paste to the editor', async () => {
    const attach = vi.fn(async (_file: File) => attached);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={() => {}} attach={attach} />);
    paste(container.querySelector('.ProseMirror')!, [new File(['plain'], 'notes.txt', { type: 'text/plain' })]);
    expect(attach).not.toHaveBeenCalled();
  });

  it('pastes the same image twice and inserts a reference for each', async () => {
    let latest = '';
    const { container } = render(
      <MarkdownEditor value={'Intro'} onChange={(v) => (latest = v)} attach={async () => attached} />,
    );
    const box = container.querySelector('.ProseMirror')!;
    paste(box, [imageFile()]);
    await waitFor(() => expect(latest).toContain('!['));
    paste(box, [imageFile()]);
    await waitFor(() => expect(latest.match(/!\[]\(/g)?.length).toBe(2));
    expect(latest.match(/\/assets\/a1/g)).toHaveLength(2);
  });

  it('refuses an over-size file without sending it', async () => {
    const attach = vi.fn(async (_file: File) => attached);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={() => {}} attach={attach} />);
    const big = pngFileOfSize(MAX_ASSET_BYTES + 1);
    await userEvent.upload(container.querySelector('input[type=file]')!, big);
    expect(await screen.findByRole('alert')).toHaveTextContent(/over the 10 MB limit/);
    expect(attach).not.toHaveBeenCalled();
  });

  it('refuses a wrong file type without sending it', async () => {
    const attach = vi.fn(async (_file: File) => attached);
    const { container } = render(<MarkdownEditor value={'Intro'} onChange={() => {}} attach={attach} />);
    paste(container.querySelector('.ProseMirror')!, [svgFile()]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/SVG is not accepted/);
    expect(attach).not.toHaveBeenCalled();
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

  // The shipping shape: Field and ComboEditor both load this lazily, so the passive effect
  // flush can land after useEditor's 1ms scheduleDestroy has already torn the view down.
  it('mounts when loaded lazily behind Suspense, with the editor view torn down between render and effect', async () => {
    const Lazy = lazy(() => Promise.resolve({ default: MarkdownEditor }));
    const { container } = render(
      <Suspense fallback={<div>loading</div>}>
        <Lazy value={'Intro\n\n![A blue cover](/assets/a1)\n\nOutro'} onChange={() => {}} />
      </Suspense>,
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/a1');
  });
});
