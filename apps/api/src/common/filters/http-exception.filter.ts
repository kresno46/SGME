import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@smge/database';
import type { Response } from 'express';

/** Menyeragamkan bentuk error: { statusCode, message, errors? } dengan pesan bahasa Indonesia. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        const message = Array.isArray(b.message) ? b.message.join(', ') : b.message;
        return res.status(status).json({
          statusCode: status,
          message: translateDefault(status, message as string | undefined),
          ...(b.errors ? { errors: b.errors } : {}),
          ...(b.details ? { details: b.details } : {}),
        });
      }
      return res
        .status(status)
        .json({ statusCode: status, message: translateDefault(status, body) });
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const target = (exception.meta?.target as string[] | undefined)?.join(', ');
        return res.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message: `Data dengan nilai yang sama sudah ada${target ? ` (${target})` : ''}`,
        });
      }
      if (exception.code === 'P2025') {
        return res
          .status(HttpStatus.NOT_FOUND)
          .json({ statusCode: HttpStatus.NOT_FOUND, message: 'Data tidak ditemukan' });
      }
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Terjadi kesalahan pada server',
    });
  }
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Permintaan tidak valid',
  401: 'Sesi tidak valid atau sudah berakhir. Silakan login kembali.',
  403: 'Anda tidak memiliki akses ke fitur ini',
  404: 'Data tidak ditemukan',
  409: 'Terjadi konflik data',
  429: 'Terlalu banyak permintaan. Coba lagi beberapa saat lagi.',
};

/** Pesan default Nest berbahasa Inggris ("Unauthorized", dll.) diganti bahasa Indonesia. */
function translateDefault(status: number, message: string | undefined): string {
  const englishDefaults = [
    'Unauthorized',
    'Forbidden',
    'Forbidden resource',
    'Not Found',
    'Bad Request',
    'Conflict',
    'ThrottlerException: Too Many Requests',
    'Too Many Requests',
  ];
  if (!message || englishDefaults.includes(message) || message.startsWith('Cannot ')) {
    return DEFAULT_MESSAGES[status] ?? message ?? 'Terjadi kesalahan';
  }
  return message;
}
