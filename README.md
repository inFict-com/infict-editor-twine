# inFict Editor (Twine)

This is a specialized fork of [Twine 2](https://github.com/klembot/twinejs), customized for the **inFict** immersive storytelling platform.

## Overview

The **inFict Editor (Twine)** is an authoring tool for creators building interactive, real-world experiences. It keeps Twine’s core editing model and adds integrations aimed at the inFict platform (Snowcone story format, passage “chip” editing, and optional remote workflows).

## Key modifications

- **Chip view / passage commands:** Form-based editing for structured request/response blocks (backed by Snowcone dialog-forms), so authors spend less time hand-editing JSON in passages.
- **Passage connections:** Connector styling reflects inFict-oriented link/action types where the story format exposes them.
- **Remote / Controller workflow:** Optional API-backed story load and publish when the editor is embedded or configured for the inFict Controller (see project env docs if you host your own build).

## Relationship to Twine

This project is a fork of the open-source Twine editor by Chris Klimas and other contributors. Twine remains the reference for general IF authoring; this fork layers inFict-specific defaults and tooling for platform authors.

**Note:** This build is optimized for the [inFict](https://infict.com) ecosystem. Default story formats and some UI paths differ from stock Twine; stories and workflows are still Twine-compatible at the data level, but you should validate against your target environment.

## Development

- **Requirements:** Node.js ≥ 20 and npm ≥ 10 (see `package.json` `engines`).
- **Install and run the web dev server:** `npm install` then `npm start` (Vite).
- **Checks:** `npm run verify` runs TypeScript and Jest in CI mode.
- **Fork architecture and extension points:** see [EXTENDING.md](EXTENDING.md).
- **Upstream docs:** [Twinery.org](https://twinery.org).
- **inFict authoring:** [Author Portal](https://infict.com).

## License

Like Twine 2, this editor is licensed under the [GNU General Public License v3](LICENSE).
