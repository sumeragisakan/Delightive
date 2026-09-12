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

## Current workspace

- Create case files and keep active and archived investigations separate.
- Record people with duplicate display names, reusable ambiguous aliases, and visual colors.
- Build second-precision timelines with exact, approximate, ranged, relative, and unknown times.
- Nest locations, assign event participants, and preserve every event aggregate revision.
- Record revisioned chapters, testimony, documents, images, and user notes as provenance sources.
- Keep accepted facts source-backed, while allowing unsourced drafts and explicit character statements.
- Link evidence to sources, people, events, and locations with revision-aware dependencies.
- Mark affected accepted claims as `needs_review` when a source, event, or upstream claim changes.
- Run cited AI consistency checks, hypothesis expansion, counterexample searches, and investigation-gap analysis against an immutable branch snapshot.
- Review every AI suggestion before turning it into a branch hypothesis; AI output cannot directly enter the trusted layer.

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

### AI configuration

Create `.env.local` in the repository root. Keep the key server-only: do not use a `NEXT_PUBLIC_` prefix and do not commit this file.

```dotenv
OPENAI_API_KEY=replace-with-your-api-key
OPENAI_MODEL=gpt-5.2
OPENAI_BASE_URL=https://api.openai.com/v1
AI_REQUEST_TIMEOUT_MS=60000
```

Restart `pnpm dev` after changing environment variables. The OpenAI adapter uses the Responses API with structured JSON output and sets `store: false`. Run inputs, validated suggestions, model metadata, and token usage are stored locally for audit; API keys and hidden model reasoning are not stored.

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

## Roadmap

1. ~~Model cases, people, aliases, events, and fact provenance.~~
2. ~~Build the case, people, and timeline workspaces.~~
3. ~~Build the fact/source review interface on top of the existing dependency model.~~
4. ~~Add branching hypothesis workflows and contradiction review.~~
5. ~~Introduce AI-assisted analysis with cited fact identifiers.~~
6. Add richer investigation planning, export, and model/provider controls.
