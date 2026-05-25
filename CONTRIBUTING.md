# Contributing to Skills Transmuter

Thank you for your interest in contributing to **Skills Transmuter**! We welcome contributions of all forms, including bug reports, feature requests, documentation improvements, and pull requests.

Please take a moment to review this document to make the contribution process smooth and effective.

---

## Code of Conduct

By participating in this project, you agree to maintain a respectful, welcoming, and professional environment. Please be kind and constructive in all communications.

---

## How to Contribute

### 1. Reporting Bugs
* Check existing issues to see if the bug has already been reported.
* Open a new issue with a descriptive title and steps to reproduce.
* Include details about your runtime environment (Node.js version, OS, target agent framework).

### 2. Suggesting Features
* Open an issue explaining the proposed feature and its use cases.
* Outline the benefits for developers migrating skills between Claude Code, Codex, and Antigravity.

### 3. Submitting Pull Requests (PRs)
* Fork the repository and create your branch from `main`.
* Follow the code standards outlined below.
* Ensure all tests pass before submitting.
* Reference any related issues in the PR description.

---

## Local Development Setup

To set up the project locally for development:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/skills-transmuter.git
   cd skills-transmuter
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the development watch mode:**
   ```bash
   npm run dev
   ```
   This will run `tsup` in watch mode to automatically compile TypeScript changes.

4. **Run the test suite:**
   ```bash
   npm run test
   ```
   We use **Vitest** for unit testing.

5. **Build for production:**
   ```bash
   npm run build
   ```
   This generates the compiled bundle in `dist/index.js`.

---

## Code & Quality Standards

* **TypeScript**: The codebase is strictly typed. Avoid `any` where possible and ensure TypeScript type checking passes without errors (`npx tsc --noEmit`).
* **JSDoc Documentation**: All public-facing modules, core functions, and types must be clearly documented with JSDocs in English.
* **Testing**: Write comprehensive unit tests in the `tests/` directory for any new logic, conversion rules, or parser features.
* **Commit Messages**: Use clean, descriptive commit messages matching conventional guidelines (e.g., `feat: add support for tool X`, `fix: resolve merge conflict parsing`).

Thank you for helping build a better developer experience for agentic AI skills!
