/**
 * Seed data awal.
 * - Selalu: role + permission default, Super Admin awal, pengaturan sistem default.
 * - Opsional (SEED_DEMO_DATA=true): akun TikTok contoh. Angka followers ditandai
 *   SIMULATED agar tidak pernah tampil sebagai data asli.
 */
import { hash } from '@node-rs/argon2';
import { PrismaClient, RoleCode } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_LABELS } from '@smge/shared';

const prisma = new PrismaClient();

const ROLE_DESCRIPTIONS: Record<RoleCode, string> = {
  SUPER_ADMIN: 'Akses penuh termasuk pengaturan sistem.',
  ADMIN: 'Mengelola pengguna, akun, campaign, integrasi, dan knowledge base.',
  MARKETING_OPERATOR: 'Mengelola prospek, outbound workstation, dan percakapan.',
  VIEWER: 'Hanya dapat melihat dashboard dan laporan.',
};

const DEFAULT_SETTINGS: Array<{ key: string; value: unknown; description: string }> = [
  {
    key: 'retention.lead_inactive_days',
    value: 730,
    description: 'Data pribadi prospek tanpa aktivitas dianonimkan setelah N hari.',
  },
  {
    key: 'retention.audit_log_days',
    value: 1095,
    description: 'Log audit disimpan selama N hari.',
  },
  {
    key: 'retention.integration_log_days',
    value: 180,
    description: 'Log integrasi disimpan selama N hari.',
  },
  {
    key: 'outbound.daily_task_limit_per_account',
    value: 30,
    description: 'Batas tugas outbound baru per akun TikTok per hari agar penjangkauan tetap personal.',
  },
  {
    key: 'ai.mode',
    value: 'COPILOT',
    description:
      'COPILOT = AI hanya memberi saran. AUTO_REPLY hanya aktif bila kanal resmi mengizinkan.',
  },
];

async function main() {
  for (const code of Object.values(RoleCode)) {
    await prisma.role.upsert({
      where: { code },
      create: {
        code,
        name: ROLE_LABELS[code],
        description: ROLE_DESCRIPTIONS[code],
        permissions: DEFAULT_ROLE_PERMISSIONS[code],
      },
      update: { name: ROLE_LABELS[code], permissions: DEFAULT_ROLE_PERMISSIONS[code] },
    });
  }
  console.log('✔ Role & permission');

  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@smge.local').toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!password) throw new Error('SEED_SUPERADMIN_PASSWORD wajib diisi di .env');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
    await prisma.user.create({
      data: {
        email,
        name: 'Super Admin',
        passwordHash: await hash(password),
        roleId: role.id,
        passwordChangedAt: new Date(),
      },
    });
    console.log(`✔ Super Admin dibuat: ${email} (segera ganti password setelah login)`);
  } else {
    console.log(`• Super Admin sudah ada: ${email}`);
  }

  for (const s of DEFAULT_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value as never, description: s.description },
      update: {},
    });
  }
  console.log('✔ Pengaturan sistem default');

  if ((await prisma.messageTemplate.count()) === 0) {
    await prisma.messageTemplate.createMany({
      data: [
        {
          name: 'Perkenalan singkat',
          lane: 'OUTBOUND',
          purpose: 'INTRODUCTION',
          content:
            'Halo {{nama}}! Aku dari @{{akun}}. Makasih udah mampir ke konten kami 🙌 ' +
            'Kalau penasaran sama Solid Mini, boleh aku kirim info singkatnya? Kalau tidak berkenan, cukup balas "stop" ya.',
        },
        {
          name: 'Follow-up setelah dibalas',
          lane: null,
          purpose: 'FOLLOW_UP',
          content:
            'Hai {{nama}}, ini lanjutan obrolan kita kemarin. Info pendaftaran Solid Mini bisa dilihat di sini: {{link}} ' +
            'Ada yang mau ditanyakan dulu?',
        },
      ],
    });
    console.log('✔ Template pesan awal (silakan sesuaikan isinya)');
  }

  if (process.env.SEED_DEMO_DATA === 'true') {
    const demo = [
      {
        username: 'demo_official',
        displayName: 'Solid Mini (Demo)',
        lane: 'OFFICIAL',
        isVerified: true,
        followersCount: 320000,
        accountType: 'BUSINESS',
      },
      {
        username: 'demo_outbound_1',
        displayName: 'Akun Outbound 1 (Demo)',
        lane: 'OUTBOUND',
        isVerified: false,
        followersCount: 95000,
        accountType: 'CREATOR',
      },
      {
        username: 'demo_outbound_2',
        displayName: 'Akun Outbound 2 (Demo)',
        lane: 'OUTBOUND',
        isVerified: false,
        followersCount: 85000,
        accountType: 'PERSONAL',
      },
    ] as const;
    for (const a of demo) {
      await prisma.tikTokAccount.upsert({
        where: { username: a.username },
        create: {
          ...a,
          profileUrl: `https://www.tiktok.com/@${a.username}`,
          followersSource: 'SIMULATED',
          notes: 'Data demo dari seed — bukan akun asli.',
        },
        update: {},
      });
    }
    console.log('✔ Akun TikTok demo (berlabel SIMULASI)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
