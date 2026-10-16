import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_CODES, ROLE_LABELS, RoleCode } from '@smge/shared';
import request from 'supertest';
import { LLM_PROVIDER, type LlmProvider } from '../src/ai/providers/llm-provider';
import { AppModule } from '../src/app.module';
import { TIKTOK_ADAPTERS, type TikTokAdapters } from '../src/integrations/integrations.service';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

export const TEST_PASSWORD = 'PasswordUji123';

export const TEST_USERS: Record<RoleCode, string> = {
  SUPER_ADMIN: 'super@test.local',
  ADMIN: 'admin@test.local',
  MARKETING_OPERATOR: 'operator@test.local',
  VIEWER: 'viewer@test.local',
};

/** `llm` / `tiktok` mengganti provider AI & adapter TikTok (default: nonaktif). */
export async function createTestApp(
  opts: { llm?: LlmProvider | null; tiktok?: TikTokAdapters } = {},
) {
  Logger.overrideLogger(['error']);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LLM_PROVIDER)
    .useValue(opts.llm ?? null)
    .overrideProvider(TIKTOK_ADAPTERS)
    .useValue(opts.tiktok ?? { loginKit: null, mock: null })
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Mengosongkan seluruh tabel (kecuali riwayat migrasi) lalu membuat role + 1 user per role. */
export async function resetDatabase(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  const passwordHash = await hash(TEST_PASSWORD);
  for (const code of ROLE_CODES) {
    const role = await prisma.role.create({
      data: { code, name: ROLE_LABELS[code], permissions: DEFAULT_ROLE_PERMISSIONS[code] },
    });
    await prisma.user.create({
      data: {
        email: TEST_USERS[code],
        name: `Pengguna ${ROLE_LABELS[code]}`,
        passwordHash,
        roleId: role.id,
      },
    });
  }
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  cookies: string[];
}

export function readCookie(
  setCookie: string[] | string | undefined,
  name: string,
): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const raw = list.find((c) => c.startsWith(`${name}=`));
  return raw?.split(';')[0].slice(name.length + 1);
}

/** Login sebagai role tertentu; mengembalikan agent supertest yang menyimpan cookie + token CSRF. */
export async function loginAs(
  app: INestApplication,
  role: RoleCode | { email: string; password: string },
) {
  const creds =
    typeof role === 'string' ? { email: TEST_USERS[role], password: TEST_PASSWORD } : role;
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/auth/login').send(creds).expect(200);
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const csrf = readCookie(cookies, 'smge_csrf');
  if (!csrf) throw new Error('Cookie CSRF tidak ditemukan');
  return { agent, csrf, cookies } satisfies Session;
}
