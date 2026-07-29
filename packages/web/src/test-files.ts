const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Uploads are validated by their leading bytes, so a test file needs a real signature rather than arbitrary content.
export function pngFile(name = 'hero.png', type = 'image/png'): File {
  return new File([new Uint8Array([...PNG_HEADER, 0x00, 0x00, 0x00, 0x0d])], name, { type });
}

export function pngFileOfSize(bytes: number, name = 'huge.png'): File {
  const body = new Uint8Array(bytes);
  body.set(PNG_HEADER);
  return new File([body], name, { type: 'image/png' });
}

export function svgFile(name = 'logo.svg'): File {
  return new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], name, { type: 'image/svg+xml' });
}

export function pdfFile(name = 'notes.pdf'): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], name, {
    type: 'application/pdf',
  });
}
