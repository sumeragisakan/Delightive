const layers = [
  {
    number: "01",
    title: "固定事实",
    description: "记录人物、时间、地点、事件与信息来源。",
  },
  {
    number: "1.5",
    title: "已采纳结论",
    description: "保留可信推论及其证据依赖，并允许随时复核。",
  },
  {
    number: "02",
    title: "探索推理",
    description: "比较假设、寻找反证，并借助 AI 展开新一轮分析。",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f4f0e8] px-6 py-10 text-[#1b1b18] sm:px-10 lg:px-16">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col rounded-[2rem] border border-black/10 bg-[#fffdf8] p-7 shadow-[0_24px_80px_rgba(45,38,24,0.10)] sm:p-12 lg:p-16">
        <header className="flex items-center justify-between border-b border-black/10 pb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em]">
            Delightive
          </p>
          <p className="font-mono text-xs text-black/50">Case file / 000</p>
        </header>

        <section className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <p className="mb-5 font-mono text-xs uppercase tracking-[0.24em] text-[#8b5e34]">
              Making detective work delightful
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-7xl">
              让每一条推论，
              <span className="block text-[#9f3f2f]">都有迹可循。</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-black/60">
              为推理作品整理时间线、人物与证据，在事实之上探索不同解释，
              并让 AI 的每一步分析都能够被引用、质疑与推翻。
            </p>
          </div>

          <div className="space-y-3">
            {layers.map((layer) => (
              <article
                key={layer.number}
                className="grid grid-cols-[3.5rem_1fr] gap-4 rounded-2xl border border-black/10 bg-white/70 p-5"
              >
                <span className="font-mono text-sm text-[#9f3f2f]">
                  {layer.number}
                </span>
                <div>
                  <h2 className="font-semibold">{layer.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-black/55">
                    {layer.description}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-black/10 pt-6 text-xs text-black/45 sm:flex-row sm:items-center sm:justify-between">
          <p>Evidence before intuition.</p>
          <p className="font-mono">Initial foundation · 2026</p>
        </footer>
      </div>
    </main>
  );
}
