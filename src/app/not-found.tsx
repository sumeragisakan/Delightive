import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <section className="w-full max-w-xl rounded-[1.75rem] border border-[var(--line)] bg-[var(--paper)] p-8 text-center shadow-[0_30px_90px_rgba(20,25,30,0.14)] sm:p-12">
        <p className="font-mono text-sm tracking-[0.2em] text-[var(--accent)]">
          CASE NOT FOUND
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
          找不到这份案件档案
        </h1>
        <p className="mt-4 leading-7 text-[var(--muted)]">
          它可能已被移除，或者链接中的档案编号不完整。
        </p>
        <Link className="primary-button mt-8 inline-flex" href="/">
          返回案件大厅
        </Link>
      </section>
    </main>
  );
}
