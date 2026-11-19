import { useEffect, useMemo, useRef, useState } from 'react';
import { CardChooser } from './CardChooser.js';
import type { SelectOption } from './Select.js';
import { anyFileAllowed } from './useAssetUpload.js';

export type AssetKind = 'image' | 'file';

export type AssetLibrary = (kind: AssetKind) => (query: string) => Promise<SelectOption[]>;

export interface AttachedAsset {
  id: string;
  title?: string;
  thumb?: string | undefined;
}

export interface AssetDialogProps {
  kind: AssetKind;
  library?: AssetLibrary | undefined;
  upload?: ((file: File) => Promise<AttachedAsset>) | undefined;
  onChoose: (asset: SelectOption) => void;
  onClose: () => void;
}

// The media library as a picker: choose a record already there, or upload a new one.
export function AssetDialog({ kind, library, upload, onChoose, onClose }: AssetDialogProps) {
  const browse = useMemo(() => library?.(kind), [library, kind]);
  const [found, setFound] = useState<SelectOption[]>([]);
  const [uploaded, setUploaded] = useState<SelectOption[]>([]);
  const known = useRef(new Map<string, SelectOption>());
  const asked = useRef(0);

  function search(query: string) {
    if (browse === undefined) return;
    const mine = ++asked.current;
    void browse(query)
      .then((options) => {
        if (mine !== asked.current) return;
        for (const o of options) known.current.set(o.value, o);
        setFound(options);
      })
      .catch(() => {
        if (mine === asked.current) setFound([]);
      });
  }

  useEffect(() => search(''), [browse]);

  const options = [...uploaded, ...found.filter((o) => !uploaded.some((u) => u.value === o.value))];

  return (
    <CardChooser
      title={kind === 'image' ? 'Insert image' : 'Link a file'}
      options={options}
      onSearch={browse === undefined ? undefined : search}
      upload={
        upload === undefined
          ? undefined
          : async (file) => {
              const asset = await upload(file);
              return { value: asset.id, label: asset.title ?? file.name, thumb: asset.thumb };
            }
      }
      onUploaded={(option) => {
        known.current.set(option.value, option);
        setUploaded((list) => [option, ...list]);
      }}
      imagesOnly={kind === 'image'}
      accept={kind === 'image' ? 'image/*' : anyFileAllowed() ? undefined : 'application/pdf'}
      onChoose={([id]) => {
        const option = id === undefined ? undefined : known.current.get(id);
        if (option !== undefined) onChoose(option);
      }}
      onClose={onClose}
    />
  );
}
