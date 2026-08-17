# BugDrop Board widget test venue

This repository is the dedicated host application for BugDrop Board's preview and closed-beta
proof. It is deliberately small: vanilla TypeScript and Vite render a real embedded Board widget,
while Vercel functions issue short-lived RS256 board tokens without exposing the private signer to
browser code.

The venue has exactly two modes and two synthetic viewers:

| Selector       | Server-owned mapping                                 |
| -------------- | ---------------------------------------------------- |
| `mode=demo`    | durable evaluator board, production venue origin     |
| `mode=ci`      | resettable CI-only board, fixed preview venue origin |
| `viewer=ada`   | `preview_ada` / Ada Preview                          |
| `viewer=grace` | `preview_grace` / Grace Preview                      |

The browser cannot provide a Worker origin, board id, tenant, app, issuer, audience, TTL, repository,
or arbitrary identity. `/api/config` converts one allowed mode into public embed configuration.
`/api/board-token` accepts exactly one mode and viewer, maps them to server-owned authority, and
signs for at most five minutes. Both the request URL origin and its `Origin` header must equal the
selected mode's fixed alias. The service refuses to start if demo and CI share either an alias or a
board id. Mode links come only from these two server-configured aliases. A valid mode entered on the
other alias moves to its canonical origin before the page requests a token, avoiding a broken `403`
board without relaxing the origin check.

## Local development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Use preview-only values in `.env.local`. A local Vite server renders the page, but Vercel functions
require `vercel dev` or focused unit tests. Never copy staging or production identifiers into this
venue. Run the complete local proof with:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:secret-scan
```

Browser E2E uses a fixed mock widget solely for venue layout and accessibility. BugDrop Board owns
the separate deployed-surface Playwright canary; a green venue test is not live-integration proof.

## Token and JWKS contract

The Board widget posts to
`/api/board-token?mode=demo|ci&viewer=ada|grace` with `Content-Type: application/json` and the exact
body `{}`. GET returns `405` with `Allow: POST`. Missing, duplicate, unknown, or additional query
keys; a request sent through the wrong alias even with a forged `Origin` header; malformed JSON;
arrays; primitives; and non-empty objects are rejected. Every response is `no-store`.

The private RSA JWK exists only as the Vercel secret `BOARD_TOKEN_PRIVATE_JWK`. The public endpoint
`/api/jwks` emits only `kty`, `n`, `e`, `use`, `alg`, and `kid`. Tokens carry fixed issuer, audience,
tenant, app, board, and viewer claims and expire after 300 seconds. Tokens may exist only in page
memory and Board API Authorization headers—never URLs, DOM, storage, logs, screenshots, traces, or
artifacts.

## Deployment setup

1. Import this repository as the Vercel project `bugdrop-board-widget-test`.
2. Set every public identifier shown in `.env.example` for the reviewed deployment environments.
3. Set `BOARD_TOKEN_PRIVATE_JWK` as a sensitive server-only Vercel secret. Do not prefix it with
   `VITE_` and do not expose it to Preview builds from untrusted forks.
4. Confirm `VERCEL_GIT_COMMIT_SHA` is present and is the expected 40-character commit.
5. Assign the reviewed production alias to the demo deployment and the fixed preview alias to the
   CI deployment. Record both exact origins in the corresponding venue variables.
6. Provision the Board hosted verifier with `/api/jwks`, the matching key id, issuer and audience,
   and a maximum TTL of 300 seconds.
7. Verify `/api/health`, both redacted configs, JWKS, exact-origin token issuance, mismatched-origin
   denial, GET denial, and the loaded widget before enabling live canaries.

The CSP in `vercel.json` names only the dedicated preview Worker. If its origin changes, update and
review CSP and the server mapping together; do not relax either to a wildcard.

## Rotation

`/api/jwks` intentionally publishes exactly one key, so this venue does not support a seamless
old/new verification overlap. Rotate in a maintenance window: disable both aliases' token issuance
and live canaries, wait at least five minutes for every old token to expire, generate a new RSA key
outside the repository, and give it a new non-secret key id. Update the preview Board verifier and
the Vercel private JWK/key-id deployment as one coordinated change, then verify the single new key
at `/api/jwks`, exact claims, both fixed-alias positive cases, and both cross-alias denials before
re-enabling issuance. Account for verifier/JWKS cache lifetime in addition to the five-minute token
TTL. Never print or commit private keys. Rotate this signer independently from GitHub Apps.

## Rollback and incident response

- Disable the Vercel signer or roll both aliases to the last reviewed deployment if token,
  provenance, origin, or containment checks fail.
- A key rollback is also a maintenance operation: disable issuance, wait out the five-minute token
  TTL and verifier/JWKS caches, then restore the prior signer and verifier configuration together.
  Do not roll back to a key suspected of compromise. The single-key JWKS never promises old/new
  overlap.
- Suspend the preview runtime GitHub App separately if Issue creation is implicated.
- Do not redirect this venue to staging or production. Restore only the isolated preview Worker,
  D1, and boards.
- Rotate the signer immediately if private material may have reached a browser, build, log, trace,
  screenshot, or artifact. Treat any such evidence as a failed security gate.
- Re-enable live CI only after exact-origin denial, JWKS, token claims, build identity, Issue cleanup,
  and zero-leftover checks pass.

## Support boundary

This is a preview host, not a hosted control plane or an npm distribution. It owns the host-side
signer and evaluator shell. BugDrop Board owns the Worker, D1, widget bundle, GitHub mirroring,
live browser orchestration, independent Issue verification, and cleanup. Production data and
credentials are out of scope.
