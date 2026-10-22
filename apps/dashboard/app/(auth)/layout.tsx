import Image from 'next/image';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Image
          src="/logo.svg"
          alt="Logo Marketing Bias Growth"
          width={64}
          height={64}
          className="size-12 shrink-0"
          priority
        />
        <div className="leading-tight">
          <p className="font-semibold">Marketing Bias Growth</p>
          <p className="text-sm text-muted-foreground">Dashboard pemasaran & CRM</p>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</div>
      <p className="mt-6 text-xs text-muted-foreground">© {new Date().getFullYear()} Marketing Bias Growth</p>
    </div>
  );
}
