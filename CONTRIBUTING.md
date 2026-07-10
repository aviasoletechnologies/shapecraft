# Contributing to shapecraft

Thanks for taking a look. This project is small enough that most contributions are welcome without a lot of ceremony - just a few things to know before you open a PR.

## Setup

```bash
git clone https://github.com/aviasoletechnologies/shapecraft.git
cd shapecraft
npm install
```

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run lint        # eslint src
npm run build       # tsup + type declarations
```

Backend tests that hit a real provider (OpenAI, Groq, Anthropic, Ollama) are skipped automatically when the relevant API key/env var isn't set - you don't need every provider's credentials to run the suite locally. `npm test` on its own is enough for most changes.

## Before opening a PR

- `npm run typecheck` and `npm test` both pass locally - CI runs the same two, plus `npm run build`, on every PR.
- New behavior has a test. A bug fix without a regression test is easy to reintroduce later.
- If you're changing public API surface (`GenerateOptions`, `ShapecraftModel`, exported types), add a line to `CHANGELOG.md` describing it - see existing entries for the format.
- Keep the PR scoped to one change. Unrelated cleanup makes review slower and harder to revert if something's wrong.

## Adding a new backend

Backends live in `src/backends/`. Each one implements `ShapecraftModel` (`src/types.ts`) - look at `src/backends/ollama.ts` for the smallest complete example (no SDK dependency, just `fetch`). The `guaranteeLevel` you pick (`native` / `constrained` / `best-effort`) should reflect what the provider actually enforces server-side, not what you'd like it to enforce - see the "What shapecraft guarantees" section in the README before picking one.

## Reporting bugs / requesting features

Open an issue - the templates will prompt for what's needed. For a bug, a minimal reproduction (schema + model + prompt that fails) is the single most useful thing you can include.

## Questions

If something in this doc or the README doesn't answer your question, open an issue anyway - it usually means the docs need fixing too.
