import { BadRequestException } from '@nestjs/common';
import { extractRecipients, RECIPIENT_FILE_MAX_ROWS } from '@smge/shared';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export const RECIPIENT_FILE_MAX_BYTES = 1024 * 1024;
export const RECIPIENT_FILE_PATTERN = /\.(csv|txt|xlsx)$/i;

async function readRows(file: { buffer: Buffer; originalname: string }): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.originalname)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const rows: string[][] = [];
    // Hanya sheet pertama; berhenti mengumpulkan sesaat setelah melewati batas (cukup untuk menolaknya)
    // supaya sheet raksasa tidak membengkakkan memori.
    wb.worksheets[0]?.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length > RECIPIENT_FILE_MAX_ROWS + 1) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cell.text;
      });
      rows.push(Array.from(cells, (c) => c ?? ''));
    });
    return rows;
  }
  return parse(file.buffer, {
    bom: true,
    delimiter: [',', ';', '\t'],
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];
}

/** Membaca file CSV/XLSX menjadi daftar penerima. Hanya membaca dan menormalkan; tidak ada yang disimpan. */
export async function readRecipientFile(file: { buffer: Buffer; originalname: string }) {
  let rows: string[][];
  try {
    rows = await readRows(file);
  } catch {
    throw new BadRequestException(
      'File tidak dapat dibaca. Gunakan CSV (UTF-8) atau Excel .xlsx yang tidak dilindungi sandi.',
    );
  }
  // +1 untuk baris header.
  if (rows.length > RECIPIENT_FILE_MAX_ROWS + 1)
    throw new BadRequestException(`Maksimal ${RECIPIENT_FILE_MAX_ROWS} baris per file`);
  return extractRecipients(rows);
}
