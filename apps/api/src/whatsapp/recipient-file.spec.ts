import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { readRecipientFile } from './recipient-file';

const csv = (text: string, originalname = 'penerima.csv') => ({
  buffer: Buffer.from(text, 'utf8'),
  originalname,
});

async function xlsx(rows: unknown[][], originalname = 'penerima.xlsx') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname };
}

describe('readRecipientFile', () => {
  it('membaca CSV dengan header, BOM, dan pemisah titik koma', async () => {
    const r = await readRecipientFile(
      csv('﻿Nama;Telepon\nBudi;0812 3456 7890\nSiti;+62 813-1111-2222\n'),
    );
    expect(r).toEqual({
      recipients: [
        { phone: '0812 3456 7890', name: 'Budi' },
        { phone: '+62 813-1111-2222', name: 'Siti' },
      ],
      invalid: 0,
      variables: [],
    });
  });

  it('membaca Excel; nomor yang tersimpan sebagai angka tetap utuh', async () => {
    const r = await readRecipientFile(
      await xlsx([
        ['Nama', 'Nomor'],
        ['Budi', 6281234567890],
        ['Siti', '081311112222'],
        ['Tanpa nomor', 'abc'],
      ]),
    );
    expect(r.recipients).toEqual([
      { phone: '6281234567890', name: 'Budi' },
      { phone: '081311112222', name: 'Siti' },
    ]);
    expect(r.invalid).toBe(1);
  });

  it('menolak file yang bukan CSV/Excel yang sah', async () => {
    await expect(
      readRecipientFile({ buffer: Buffer.from('bukan zip'), originalname: 'x.xlsx' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('menolak file melebihi batas baris, bukan memotongnya diam-diam', async () => {
    const lines = Array.from(
      { length: 1002 },
      (_, i) => `Nama${i},08123456${String(i).padStart(4, '0')}`,
    );
    await expect(readRecipientFile(csv(lines.join('\n')))).rejects.toThrow(/Maksimal 1000 baris/);
    await expect(readRecipientFile(await xlsx(lines.map((l) => l.split(','))))).rejects.toThrow(
      /Maksimal 1000 baris/,
    );
  });
});
