import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/** Menyiapkan skema database test (dijalankan sekali sebelum seluruh integration test). */
export default function globalSetup() {
  config({ path: resolve(__dirname, '../../../.env') });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST belum diatur di .env');
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error('Demi keamanan, nama database test harus mengandung kata "test".');
  }
  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(__dirname, '../../../packages/database'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
