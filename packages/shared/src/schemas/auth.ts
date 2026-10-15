import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password minimal ${PASSWORD_MIN_LENGTH} karakter`)
  .max(128, 'Password maksimal 128 karakter')
  .regex(/[a-z]/, 'Password harus mengandung huruf kecil')
  .regex(/[A-Z]/, 'Password harus mengandung huruf besar')
  .regex(/\d/, 'Password harus mengandung angka');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Format email tidak valid')
  .max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password wajib diisi').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Kode harus 6 digit angka');

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1),
  code: totpCodeSchema,
});
export type TwoFactorLoginInput = z.infer<typeof twoFactorLoginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Konfirmasi password tidak sama',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Password saat ini wajib diisi'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Konfirmasi password tidak sama',
    path: ['confirmPassword'],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'Password baru harus berbeda dari password saat ini',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const enableTwoFactorSchema = z.object({ code: totpCodeSchema });
export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, 'Password wajib diisi'),
  code: totpCodeSchema,
});
