import { z } from 'zod';

// Per-organization logo rules. The value is stored on organizations.logo_url and may be
// an uploaded image (data URI), a full https URL, or a site path such as /logo.png.
export const LOGO_MAX_BYTES = 200 * 1024;
export const LOGO_MAX_CHARS = 400000;

export const logoUrlSchema = z
  .string()
  .max(LOGO_MAX_CHARS, 'Logo is too large. Upload an image of 200 KB or less.')
  .refine(
    (v) => v === '' || v.startsWith('data:image/') || /^https?:\/\//i.test(v) || v.startsWith('/'),
    'Logo must be an uploaded image, a full https:// URL, or a path such as /logo.png.'
  );

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

export function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!LOGO_ACCEPT.split(',').includes(file.type)) {
      reject(new Error('Choose a PNG, JPG, WebP or SVG image.'));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      reject(new Error(`Image is ${Math.round(file.size / 1024)} KB. The limit is ${LOGO_MAX_BYTES / 1024} KB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}
