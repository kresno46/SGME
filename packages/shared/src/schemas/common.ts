import { z } from 'zod';

export const uuidSchema = z.string().uuid('ID tidak valid');

/** Query pagination standar untuk endpoint daftar. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Field opsional dari form: string kosong diperlakukan sebagai null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maksimal ${max} karakter`)
    .nullish()
    .transform((v) => (v ? v : null));

export const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https:\/\/[^\s]+$/i.test(v), 'URL harus diawali https://');
