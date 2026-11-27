# Contributing to SVS

Thanks for your interest in contributing.

## Getting Started

### Prerequisites
- Python 3.11+ (standard CPython, not MSYS/MINGW)
- Node.js 20+ and npm
- Git

### Setup

```bash
# Backend
cd backend
python -m venv .venv-cpython
.venv-cpython\Scripts\activate
python -m pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### Running locally

Double-click `run-svs.bat` from the project root, or:

```bash
# Terminal 1 — backend
cd backend
.venv-cpython\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — frontend
cd frontend
npm run dev
```

Open http://127.0.0.1:3000

### Running tests

```bash
cd backend
.venv-cpython\Scripts\python.exe -m pytest tests -v
```

### Frontend checks

```bash
cd frontend
npm run lint      # TypeScript typecheck
npm run build     # Production build
```

## Pull Request Process

1. Fork the repo and create a feature branch
2. Make your changes
3. Run tests and lint (see above)
4. Write a clear PR description explaining what and why
5. Submit the PR

## Code Style

- **Python:** Follow existing patterns. Use type hints. Keep functions small.
- **TypeScript:** Strict mode. Use existing components and tokens.
- **Commits:** Use conventional commits (feat:, fix:, docs:, etc.)

## What to Contribute

Good first issues:
- Add new Semgrep rulesets or scanner integrations
- Improve frontend accessibility (keyboard nav, screen reader)
- Add new report formats
- Fix scanner timeout/edge cases
- Improve documentation

## Reporting Bugs

Open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- OS and Python/Node versions
- Relevant logs from the API window

## Code of Conduct

Be respectful. This is a security tool — treat vulnerability reports seriously.