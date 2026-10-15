export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground">
          SM
        </div>
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
