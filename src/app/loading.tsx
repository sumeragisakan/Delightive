export default function Loading() {
  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto min-h-[36rem] max-w-[92rem] animate-pulse rounded-[1.75rem] border border-black/10 bg-[var(--paper)] p-8 shadow-[0_30px_90px_rgba(20,25,30,0.12)]">
        <div className="h-14 rounded-2xl bg-[var(--ink)]/90" />
        <div className="mt-10 h-4 w-28 rounded bg-[var(--line)]" />
        <div className="mt-4 h-10 w-2/3 rounded bg-[var(--line)]" />
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="h-48 rounded-2xl bg-[var(--paper-deep)]" />
          <div className="h-48 rounded-2xl bg-[var(--paper-deep)]" />
        </div>
      </div>
    </main>
  );
}
