# GitHub Private Repository Setup

This project should be pushed to a private GitHub repository first. It contains local dashboards, trading-related configuration, and environment-driven integrations.

## Safety Rules

- Commit `.env.example`.
- Do not commit `.env.local`.
- Do not commit `.signal-hub/`, `.telegram-login-state.json`, logs, local snapshots, or `node_modules/`.
- Keep production secrets only in the server environment or GitHub/VPS secret storage.
- If a real secret is accidentally committed, rotate that secret before pushing.

## One-Time Local Setup

Install Git for Windows or GitHub Desktop first. Then run these commands from the project root:

```powershell
git init
git branch -M main
git status --short
```

Review `git status --short` before staging. The output must not include `.env.local`, `.signal-hub/`, `.telegram-login-state.json`, `.next/`, `node_modules/`, logs, or snapshots.

## First Commit

```powershell
git add .
git status --short
git commit -m "Initial Signal Hub app"
```

If `git status --short` shows any local secret or runtime artifact after `git add .`, stop and update `.gitignore` before committing.

## Create GitHub Repo

Create a private empty repository on GitHub named `signal-hub`. Do not initialize it with a README, license, or `.gitignore` because this project already has those files.

Then connect and push:

```powershell
git remote add origin https://github.com/<your-user>/signal-hub.git
git push -u origin main
```

## After Push

Use GitHub as the source of truth:

- Make code changes locally.
- Commit and push to GitHub.
- Pull from GitHub on the VPS.
- Keep `.env.local` values out of Git and configure them directly on the server.
