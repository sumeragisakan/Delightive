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
- pnpm

The persistence and AI-provider layers will be added behind explicit interfaces as the domain model is implemented.

## Local development

Open PowerShell in the repository and activate the project-local toolchain:

```powershell
. .\Activate.ps1
pnpm install
pnpm dev
```

Then open <http://localhost:3000>.

Quality checks:

```powershell
pnpm lint
pnpm build
```

## Initial roadmap

1. Model cases, people, aliases, events, and fact provenance.
2. Build timeline and evidence views.
3. Add branching hypotheses and dependency tracking.
4. Introduce AI-assisted analysis with cited fact identifiers.
