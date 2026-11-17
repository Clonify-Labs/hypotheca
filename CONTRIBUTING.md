# Contributing to Hypotheca

Thank you for helping improve Hypotheca!

## Engineering Principles

1. **Browser-Native TypeScript Runtime**:
   - All numerical algorithms (`src/engine/core/*`, `src/engine/classical/*`, `src/modules/advanced-stats/*`) execute directly in TypeScript inside V8 / Web Workers with no Python backend dependencies.
2. **Rule-Based & Reproducible Outputs**:
   - Assumption routing, APA 7 table/manuscript formatting, citation matching, R/Python/SPSS script generation, and survey cleaning must remain strictly deterministic and reproducible.
3. **Numerical Parity & Edge-Case Verification**:
   - Every statistical procedure must include unit tests in Vitest (`npx vitest run`) covering valid reference values and degenerate input edge cases (`StatInputError`).
4. **Academic Design Tokens**:
   - Use CSS design tokens from `src/styles/tokens.css` across all components and support both day and night themes without hardcoded hex colors in `.tsx` files.

## Local Development

```bash
npm install
npx tsc --noEmit
npx vitest run
npm run dev
```

## Pull Request Checklist

- [ ] Pure TypeScript implementation with explicit types (`npx tsc --noEmit` passes)
- [ ] Unit tests added and passing (`npx vitest run`)
- [ ] Clean production build (`npm run build`)

## Contributor License Grant

By submitting a contribution (including a Pull Request or patch) to this repository, you confirm that it is your original work and grant **Clonify Labs Mühendislik San. ve Tic. A.Ş.** a perpetual, worldwide, non-exclusive, irrevocable, royalty-free copyright and patent license to use, reproduce, modify, sublicense, and distribute your contribution under the [PolyForm Noncommercial License 1.0.0](LICENSE) as well as under separate commercial licenses.
