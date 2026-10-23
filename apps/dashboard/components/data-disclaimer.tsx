'use client';

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/overlays';

export function DataDisclaimer() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="w-full">
          <Info className="size-3.5" /> Disclaimer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disclaimer Pengelolaan Data</DialogTitle>
          <DialogDescription>Marketing Bias Growth</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Seluruh data yang Anda masukkan, kumpulkan, atau hasilkan melalui platform ini menjadi
            aset informasi milik pengelola Marketing Bias Growth untuk mendukung kegiatan operasional
            dan pemasaran perusahaan.
          </p>
          <p>
            Data tersebut mencakup data prospek, hasil pengumpulan followers, template pesan, serta
            riwayat aktivitas dan komunikasi yang tercatat dalam sistem.
          </p>
          <p>
            Setiap pengguna wajib menjaga kerahasiaan data dan menggunakannya hanya sesuai tugas serta
            hak akses yang diberikan. Menyalin, membagikan, atau menggunakan data untuk kepentingan
            pribadi maupun pihak lain memerlukan izin dari pengelola.
          </p>
          <p>
            Pengelolaan data tetap harus menghormati hak privasi pemilik data, ketentuan platform
            terkait, dan peraturan yang berlaku. Kepemilikan aset informasi perusahaan tidak
            menghapus hak individu atas data pribadinya.
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>Tutup</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
