# Trouble Painter Server

Backend for **Trouble Painter**, a real-time multiplayer drawing game. Players take turns adding strokes to a shared canvas. One of them is the mafia and does not know the keyword. After the drawing, everyone votes on who the mafia is, and the mafia gets a chance to guess the keyword.

The server speaks plain HTTP for sign-in and a few lookups, and WebSocket for everything that happens inside a room.

[한국어](README.ko.md)

## Links

- [App Store](https://apps.apple.com/app/id6836675233)
- [Play Store](https://play.google.com/store/apps/details?id=kr.co.devstory.troublepainter.prod)
- Blog: [Part 1](https://blog.devstory.co.kr/en/post/trouble-painter-01/), [Part 2](https://blog.devstory.co.kr/en/post/trouble-painter-02/)

## Features

- Anonymous sign-in with short-lived access tokens and refresh tokens (JWT, HS256).
- Private rooms with a room code, host-controlled rules, ready checks and kicking.
- Quick-start matchmaking with an accept step and FCM push notifications.
- Game flow: ready, drawing turns, vote, answer, result. Strokes are relayed as incremental pieces.
- Disconnect grace periods, and rooms restored after a restart from a SQLite snapshot.
- Game history stored in SQLite, with a daily backup job.
- Prometheus metrics served on loopback only.

## Tech stack

- Node.js (version pinned in [.nvmrc](.nvmrc)) and TypeScript
- [Fastify](https://fastify.dev) for HTTP, [ws](https://github.com/websockets/ws) for WebSocket
- [jose](https://github.com/panva/jose) for tokens, [zod](https://zod.dev) for validation
- SQLite (`node:sqlite`) for snapshots and history
- [firebase-admin](https://github.com/firebase/firebase-admin-node) for FCM, [pino](https://getpino.io) for logs, [prom-client](https://github.com/siimon/prom-client) for metrics
- [Vitest](https://vitest.dev) for tests

## Architecture

Code is organized feature-first, and each feature is split into layers with ports and adapters:

```
src/
  features/
    auth/       sign-in and token reissue
    game/       rooms, game flow, history
    matching/   quick-start queue and push
  shared/       WebSocket gateway, HTTP helpers, config, logging, metrics
  backup/       daily game history backup job
  app.ts        wires everything together
  main.ts       entry point
```

Inside a feature:

- `domain/` holds entities and rules with no I/O.
- `application/` holds use cases and the ports they depend on.
- `adapters/` translates HTTP and WebSocket messages to use cases.
- `infrastructure/` implements the ports (SQLite, in-memory, FCM, JWT, ...).

Rooms live in memory while the server runs and are snapshotted to SQLite so they survive a restart.

## HTTP API

| Method | Path                           | Purpose                                      |
| ------ | ------------------------------ | -------------------------------------------- |
| POST   | `/api/v1/auth/anonymous-signin` | Create an anonymous user and issue tokens   |
| POST   | `/api/v1/auth/reissue`          | Exchange a refresh token for new tokens     |
| GET    | `/api/v1/config`                | Values the app needs before opening a socket |
| POST   | `/api/v1/developer`             | Tell whether a device uuid is a developer's |

The WebSocket endpoint is `/ws`. Message types are defined in [src/shared/adapters/ws/protocol.ts](src/shared/adapters/ws/protocol.ts).

## Getting started

Requirements: the Node.js version in `.nvmrc`.

```sh
npm ci
npm run typecheck
npm test
```

The tests use their own complete settings and keyword fixtures, so they run without any private files.

### Running locally

All settings are required and there are no defaults in code. The server loads them from `.env/<APP_ENV>/server.env` (`dev` or `prod`), and variables already set in the process take precedence. The full list of settings, with their types, is the schema in [src/shared/infrastructure/config/env.ts](src/shared/infrastructure/config/env.ts). A working example is in [test/support/env.ts](test/support/env.ts).

With a `.env/dev/server.env` in place:

```sh
make run ENV=dev     # watch mode: rebuild on save, restart on rebuild
```

or build and start it directly:

```sh
npm run build
npm run start:dev
```

Besides the settings, a running server needs:

- a keywords directory containing one `<locale>.json` per locale (see [test/fixtures/keywords](test/fixtures/keywords) for the format),
- optionally a Firebase service account for push (set `PUSH_ENABLED=false` to log pushes instead of sending them).

## Configuration and secrets

The `.env/` directory is gitignored on purpose. It holds environment settings, secrets, keyword data, service account keys and deployment scripts, and is kept in a separate private repository. Nothing in this repository contains a secret.

## Deployment

Deployment targets are driven by `make deploy-dev` and `make deploy-prod`, which call scripts in the private `.env/` directory. The [monitoring](monitoring) and [backup](backup) directories contain the systemd units and configs for Prometheus, Grafana and the daily backup job.

## License

No license has been chosen yet. Until one is added, all rights are reserved.
