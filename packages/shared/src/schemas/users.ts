import { z } from 'zod';
import { ROLE_CODES, USER_STATUSES } from '../enums';
import { paginationQuerySchema } from './common';
import { emailSchema, passwordSchema } from './auth';

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(100),
  email: emailSchema,
  role: z.enum(ROLE_CODES, { errorMap: () => ({ message: 'Role tidak valid' }) }),
  password: passwordSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(100),
    role: z.enum(ROLE_CODES),
    status: z.enum(USER_STATUSES),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Tidak ada perubahan');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const adminResetPasswordSchema = z.object({ password: passwordSchema });

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: z.enum(ROLE_CODES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  actorId: z.string().uuid().optional(),
  entityType: z.string().trim().max(50).optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
