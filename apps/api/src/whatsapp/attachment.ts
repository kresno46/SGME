import { BROADCAST_ATTACHMENT_TYPES, type BroadcastAttachmentMime } from '@smge/shared';

/**
 * Nama berkas yang aman ditampilkan, disimpan, dan dikirim: tanpa path, tanpa karakter kontrol atau simbol aneh, dan
 * dengan ekstensi yang sesuai isi file (nama dari klien tidak dipercaya). Multer membaca nama sebagai latin1, jadi
 * nama UTF-8 dikembalikan dulu.
 */
export function cleanFilename(original: string, mime: BroadcastAttachmentMime): string {
  const utf8 = Buffer.from(original, 'latin1').toString('utf8');
  const decoded = utf8.includes('�') ? original : utf8;
  const ext = BROADCAST_ATTACHMENT_TYPES[mime].ext;
  const base = decoded
    .replace(/^.*[\\/]/, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
    .trim()
    .slice(0, 80);
  return `${base || 'lampiran'}.${ext}`;
}
