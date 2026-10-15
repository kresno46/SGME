import { z, ZodIssueCode, type ZodErrorMap } from 'zod';

/** Pesan error default Zod dalam bahasa Indonesia (dipakai API & dashboard). */
export const indonesianErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null')
        return { message: 'Wajib diisi' };
      return { message: 'Tipe data tidak valid' };
    case ZodIssueCode.invalid_enum_value:
      return { message: 'Pilihan tidak valid' };
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Format email tidak valid' };
      if (issue.validation === 'uuid') return { message: 'ID tidak valid' };
      if (issue.validation === 'url') return { message: 'URL tidak valid' };
      return { message: 'Format tidak valid' };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return {
          message: issue.minimum === 1 ? 'Wajib diisi' : `Minimal ${issue.minimum} karakter`,
        };
      }
      return { message: `Minimal ${issue.minimum}` };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Maksimal ${issue.maximum} karakter` };
      return { message: `Maksimal ${issue.maximum}` };
    case ZodIssueCode.unrecognized_keys:
      return { message: 'Terdapat field yang tidak dikenal' };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(indonesianErrorMap);
