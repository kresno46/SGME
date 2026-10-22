import Image from 'next/image';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Image
          src="/logo.png"
          alt="Logo Solid Mini"
          width={314}
          height={537}
          className="h-12 w-auto"
          priority
        />
        <div className="leading-tight">
          <p className="font-semibold">Solid Mini Growth Engine</p>
          <p className="text-sm text-muted-foreground">Dashboard pemasaran & CRM</p>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</div>
      <p className="mt-6 text-xs text-muted-foreground">© {new Date().getFullYear()} Solid Mini</p>
    </div>
  );
}
