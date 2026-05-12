# Contributing

Contributions are welcome! Here's how to get started.

## Development Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   npm ci
   ```
3. Run tests to verify everything works:
   ```bash
   npm test
   ```

## Development Workflow

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type-check without emitting
npm run typecheck

# Build the package
npm run build
```

## Submitting Changes

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```
2. Make your changes
3. Ensure all checks pass:
   ```bash
   npm run format:check
   npm run build
   ```
   The `build` command runs typecheck, lint, and tests with **100% coverage enforcement** (statements, branches, functions, lines). If coverage drops below 100%, the build fails.
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `refactor:` for code refactoring
   - `test:` for adding or updating tests
   - `chore:` for maintenance tasks
5. Push your branch and open a Pull Request against `main`

For larger changes, please open an issue first to discuss the approach. Reviews are done on a best-effort basis.

## Guidelines

- Write tests for new functionality — 100% coverage is enforced
- Keep changes focused — one logical change per PR
- Use explicit TypeScript types (avoid `any`)
- Ensure zero runtime dependencies are maintained
- Run `npm run format` before committing (Prettier formatting is checked in CI)
- Tax logic changes must be verified against HMRC published guidance
