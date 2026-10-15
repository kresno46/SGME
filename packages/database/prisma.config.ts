import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Catatan: variabel environment dimuat lewat dotenv-cli pada script package.json
// (lihat "migrate:dev", "seed", dll.) atau dari environment container di produksi.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
