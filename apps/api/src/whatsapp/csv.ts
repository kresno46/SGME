import { stringify } from 'csv-stringify/sync';

/**
 * Sel yang diawali rumus (`=`, `+`, `-`, `@`) diberi tanda kutip agar Excel tidak menjalankannya. Nama kontak dan
 * nama penerima berasal dari pengguna lain atau dari file unggahan, jadi tidak boleh dipercaya apa adanya.
 */
export const csvSafe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** CSV dengan BOM supaya Excel membaca UTF-8. */
export const toCsv = (header: string[], rows: string[][]) => '﻿' + stringify([header, ...rows]);
