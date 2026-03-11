# AGENTS

Read `/home/cnurmi/dev/AGENTS.md` first.

## Repo Purpose

This repo provides the social-to-mealie application and its deployment helpers.

## Repo-Specific Non-Negotiables

- local development happens on `devbox`
- deployment integration must stay aligned with `homeserver`
- keep build contexts, bind mounts, and deploy helper paths accurate
- preserve the documented `make check` path when changing app or tooling config

## Validation

Run:

```bash
make check
```

before handoff or merge when dependencies are installed.

## Deployment Constraints

- deployment changes affect a live app on `mediasrv`
- do not change the repo/deploy contract without updating docs and helper scripts together
