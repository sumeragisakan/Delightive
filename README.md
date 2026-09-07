# Delightive

Making detective work delightful.

Delightive is a reasoning workspace for detective stories and mystery analysis. It helps users organize people, timelines, events, facts, and competing hypotheses while keeping every conclusion traceable to its evidence.

## Reasoning model

- **Facts** — information explicitly established by the source material.
- **Accepted inferences** — conclusions the user currently trusts, but can still revisit.
- **Exploration** — provisional hypotheses, counterexamples, and AI-assisted analysis.

## Technology

- Next.js App Router
- React and TypeScript
- Tailwind CSS
- Drizzle ORM and SQLite
- pnpm

The SQLite database is local by default. The persistence boundary is kept on the server so a remote database can replace it later without coupling UI code to a specific driver.

## Local development

Open PowerShell in the repository and activate the project-local toolchain:

```powershell
. .\Activate.ps1
pnpm install
pnpm db:migrate
pnpm dev
```

Then open <http://localhost:3000>.

The default database is stored at `.data/delightive.sqlite`. Override it with `DATABASE_PATH`; see `.env.example`.

Quality checks:

```powershell
pnpm test
pnpm lint
pnpm build
```

Database schema workflow:

```powershell
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

Migration files under `drizzle/` are committed. Local database files under `.data/` are not.

## Initial roadmap

1. Model cases, people, aliases, events, and fact provenance.
2. Build timeline and evidence views.
3. Add branching hypotheses and dependency tracking.
4. Introduce AI-assisted analysis with cited fact identifiers.
