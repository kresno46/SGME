import { BadRequestException } from '@nestjs/common';
import { findUnknownPlaceholders, renderTemplate, type TemplateVariables } from '@smge/shared';
import { env } from '../config/env';

/** Link registrasi dengan UTM. Kosong bila SOLID_MINI_REGISTRATION_URL belum diatur. */
export function registrationLink(trackingCode?: string | null): string | null {
  const base = env().SOLID_MINI_REGISTRATION_URL;
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set('utm_source', 'tiktok');
  url.searchParams.set('utm_medium', 'outbound');
  if (trackingCode) url.searchParams.set('utm_campaign', trackingCode);
  return url.toString();
}

/** Resolve before persisting or claiming; raw template markers must never reach TikTok. */
export function renderOutboundMessage(content: string, vars: TemplateVariables): string {
  const unknown = findUnknownPlaceholders(content);
  if (unknown.length)
    throw new BadRequestException('Variabel template tidak dikenal: ' + unknown.join(', '));
  for (const key of ['link', 'campaign'] as const) {
    if (new RegExp('\\{\\{\\s*' + key + '\\s*\\}\\}').test(content) && !vars[key]?.trim())
      throw new BadRequestException(
        key === 'link'
          ? 'Link template belum diatur. Ganti {{link}} dengan URL lengkap, tanpa kurung kurawal.'
          : 'Campaign belum dipilih. Ganti {{campaign}} dengan teks yang ingin dikirim.',
      );
  }
  const message = renderTemplate(content, vars);
  if (message.includes('{{') || message.includes('}}'))
    throw new BadRequestException('Masih ada variabel yang belum terisi. Periksa isi pesan.');
  if (message.trim().length < 5 || message.length > 2000)
    throw new BadRequestException('Pesan harus 5-2000 karakter setelah personalisasi.');
  return message;
}
