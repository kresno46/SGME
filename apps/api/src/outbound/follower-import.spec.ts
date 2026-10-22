import { followerImportSchema } from '@smge/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { FollowerImportService } from './follower-import.service';

describe('FollowerImportService', () => {
  const actor = { id: 'operator-id', email: 'operator@example.com' } as RequestUser;
  const input = () =>
    followerImportSchema.parse({
      accountId: 'f1234567-1234-4123-8123-123456789012',
      batch: {
        format: 'smge-followers-v1',
        accountUsername: '@solid.mini',
        collectedAt: '2026-10-19T10:00:00.000Z',
        stopReason: 'Operator berhenti',
        followers: [
          { username: '@BARU_1', displayName: 'Baru' },
          { username: 'baru_1' },
          { username: 'lama_1' },
          { username: 'dihapus_1' },
          { username: 'blokir_1' },
          { username: 'solid.mini' },
        ],
      },
    });
  function setup() {
    const tx = {
      lead: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { tiktokUsernameNormalized: 'lama_1' },
            { tiktokUsernameNormalized: 'dihapus_1' },
          ])
          .mockResolvedValueOnce([{ id: 'created-id' }]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      doNotContactEntry: {
        findMany: jest.fn().mockResolvedValue([{ valueNormalized: 'blokir_1' }]),
      },
      leadActivity: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      tikTokAccount: {
        findFirst: jest.fn().mockResolvedValue({
          id: input().accountId,
          username: 'solid.mini',
          lane: 'OUTBOUND',
          status: 'ACTIVE',
        }),
      },
      $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new FollowerImportService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    return { service, prisma, tx, audit };
  }

  it('melewati duplikat, identitas lama/dihapus, DNC, dan akun sendiri tanpa memberi izin', async () => {
    const { service, tx, audit } = setup();
    const result = await service.import(actor, input(), { ipAddress: null, userAgent: null });
    expect(result).toEqual({
      received: 6,
      unique: 5,
      duplicateRows: 1,
      blocked: 1,
      existing: 2,
      self: 1,
      created: 1,
    });
    const args = tx.lead.createMany.mock.calls[0][0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toHaveLength(1);
    expect(args.data[0]).toMatchObject({
      tiktokUsernameNormalized: 'baru_1',
      source: 'IMPORT',
      sourceAccountId: input().accountId,
      tags: ['tiktok-followers', 'browser-collected'],
    });
    expect(args.data[0]).not.toHaveProperty('consents');
    expect(args.data[0]).not.toHaveProperty('doNotContact');
    expect(tx.leadActivity.createMany).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.followers_imported', actor }),
    );
    // No deletedAt filter: deleted usernames remain in duplicate detection.
    expect(tx.lead.findMany.mock.calls[0][0].where).not.toHaveProperty('deletedAt');
  });

  it('menolak akun sumber berbeda sebelum mengubah data', async () => {
    const { service, prisma } = setup();
    const request = input();
    request.batch.accountUsername = 'akun.lain';
    await expect(
      service.import(actor, request, { ipAddress: null, userAgent: null }),
    ).rejects.toThrow('berbeda');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('menolak akun hilang, tidak aktif, atau bukan Outbound', async () => {
    const { service, prisma } = setup();
    for (const account of [
      null,
      { lane: 'OFFICIAL', status: 'ACTIVE' },
      { lane: 'OUTBOUND', status: 'PAUSED' },
    ]) {
      prisma.tikTokAccount.findFirst.mockResolvedValueOnce(account);
      await expect(
        service.import(actor, input(), { ipAddress: null, userAgent: null }),
      ).rejects.toThrow();
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('menghitung tabrakan upload bersamaan sebagai existing dan tidak membuat aktivitas palsu', async () => {
    const { service, tx } = setup();
    tx.lead.createMany.mockResolvedValueOnce({ count: 0 });
    tx.lead.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const request = input();
    request.batch.followers = [{ username: 'baru_1' }];
    const result = await service.import(actor, request, { ipAddress: null, userAgent: null });
    expect(result.created).toBe(0);
    expect(result.existing).toBe(1);
    expect(tx.leadActivity.createMany).not.toHaveBeenCalled();
  });

  it('melaporkan kegagalan transaksi dan tidak melaporkan sukses/audit', async () => {
    const { service, tx, audit } = setup();
    tx.leadActivity.createMany.mockRejectedValueOnce(new Error('database gagal'));
    await expect(
      service.import(actor, input(), { ipAddress: null, userAgent: null }),
    ).rejects.toThrow('database gagal');
    expect(audit.log).not.toHaveBeenCalled();
  });
});
