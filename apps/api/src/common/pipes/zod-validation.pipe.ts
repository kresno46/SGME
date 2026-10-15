import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validasi body/query memakai skema Zod dari @smge/shared,
 * sehingga aturan validasi frontend dan backend identik.
 */
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      (errors[key] ??= []).push(issue.message);
    }
    throw new BadRequestException({
      statusCode: 400,
      message: result.error.issues[0]?.message ?? 'Data tidak valid',
      errors,
    });
  }
}
