import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { LIMITS } from '@azhoot/contracts';
import { Button, cn } from '@azhoot/ui';
import { api, describeError } from '@/lib/api';
import { assetUrl } from '@/lib/config';

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
  disabled?: boolean;
  compact?: boolean;
}

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

export function ImageUpload({ value, onChange, label, disabled, compact }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ACCEPT.includes(file.type)) return setError('Use JPEG, PNG ou WebP.');
    if (file.size > LIMITS.uploadMaxMb * 1024 * 1024)
      return setError('A imagem pode ter no máximo 5 MB.');
    const fd = new FormData();
    fd.append('file', file);
    setLoading(true);
    try {
      const res = await api<{ url: string }>('/uploads/images', { method: 'POST', formData: fd });
      onChange(res.url);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="grid gap-2">
      {value ? (
        <div
          className={cn(
            'relative overflow-hidden rounded-xl border border-border bg-muted',
            compact ? 'h-20 w-32' : 'aspect-video max-h-56',
          )}
        >
          <img src={assetUrl(value)} alt="" className="size-full object-contain" />
          {!disabled && (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute right-2 top-2 size-9"
              onClick={() => onChange(null)}
              aria-label={`Remover ${label.toLowerCase()}`}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          loading={loading}
          onClick={() => input.current?.click()}
          className={compact ? 'w-fit' : 'w-full border-dashed py-6'}
        >
          <ImagePlus /> {label}
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {error && (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
