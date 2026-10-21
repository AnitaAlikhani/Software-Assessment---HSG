import { normalizePhone } from './bookingData';

export function validateOptionalContact(email: string, phone: string): string | null {
  if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address or leave it blank.';
  if (phone.trim() && !/^\+?[0-9]{7,15}$/.test(normalizePhone(phone))) return 'Enter a phone number with 7 to 15 digits or leave it blank.';
  return null;
}

/** Social profile fields historically accepted host/path, so add HTTPS there. */
export function normalizeWebsiteUrl(value: string, allowMissingScheme = false): string | null {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/\s/.test(trimmed)) return null;
  const candidate = allowMissingScheme && !/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? `https://${trimmed}` : trimmed;
  if (!/^https?:\/\//i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Public salon links need a complete host, not https://, a bare word or an
    // empty label. URL handles international domain names and IP syntax.
    if (!url.hostname.includes('.') || !url.hostname.split('.').every((part) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(part))) return null;
    return url.href;
  } catch { return null; }
}

export function validateLogoFile(file: { type: string; size: number }): string | null {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'Choose a PNG, JPEG or WebP image.';
  if (file.size === 0 || file.size > 500 * 1024) return 'Choose an image smaller than 500 KB.';
  return null;
}
