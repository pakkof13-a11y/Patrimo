#!/bin/bash
#
# Préparation d'une session Claude Code sur le web.
#
# Le conteneur est recréé sans prévenir en cours de session, et il se recloné
# alors sur la révision d'origine de la session — pas sur la pointe de la
# branche. Tout ce qui a été poussé depuis semble avoir disparu : le dépôt
# revient en arrière, la base perd ses dernières migrations, et le client
# Prisma généré ne correspond plus au schéma. Rien n'est réellement perdu —
# tout est sur `origin` — mais il faut s'en apercevoir, et c'est ce qui coûte.
#
# Ce script remet l'espace de travail en état à chaque démarrage. Il est
# idempotent : sur un conteneur déjà à jour, il ne fait presque rien.
set -euo pipefail

# Environnement local : rien à préparer, la machine de l'utilisateur est la
# sienne. On ne touche ni à son dépôt ni à sa base.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

log() { echo "[session-start] $*"; }

# ── 1. Resynchroniser la branche sur `origin` ───────────────────────────────
#
# Uniquement si l'arbre est propre *et* strictement en retard. Un arbre sale
# contient du travail en cours : le réinitialiser détruirait ce que le
# reclonage, lui, n'a pas touché. Dans le doute, on ne fait rien et on le dit.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
  if git fetch --quiet origin "$branch" 2>/dev/null; then
    if [ -n "$(git status --porcelain)" ]; then
      log "arbre modifié : resynchronisation ignorée (rien n'est écrasé)"
    else
      local_sha="$(git rev-parse HEAD)"
      remote_sha="$(git rev-parse "origin/$branch")"
      if [ "$local_sha" != "$remote_sha" ]; then
        # `--is-ancestor` : on n'avance que si l'on est réellement en retard.
        # Devant l'origine, on aurait des commits locaux non poussés à garder.
        if git merge-base --is-ancestor "$local_sha" "$remote_sha"; then
          log "branche en retard sur origin/$branch → resynchronisation"
          git reset --hard "origin/$branch" --quiet 2>/dev/null ||
            git reset --hard "origin/$branch"
        else
          log "commits locaux non poussés : resynchronisation ignorée"
        fi
      fi
    fi
  else
    log "origin injoignable : on continue avec l'état local"
  fi
fi

# ── 2. Dépendances ─────────────────────────────────────────────────────────
# `install` et non `ci` : l'état du conteneur est mis en cache après le hook,
# et `install` sait ne rien faire quand tout est déjà là.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  log "installation des dépendances"
  npm install --no-audit --no-fund
fi

# ── 3. Base de données locale ──────────────────────────────────────────────
if command -v service >/dev/null 2>&1; then
  service postgresql start >/dev/null 2>&1 || true
fi

# ── 4. Client Prisma et migrations ─────────────────────────────────────────
#
# Les deux pièges observés : un client généré à partir d'un schéma périmé
# (`tsc` échoue sur des champs pourtant présents dans le schéma), et une base
# à laquelle il manque les dernières migrations (`ColumnNotFound` au premier
# appel d'API). Les deux se règlent ici, une fois pour toutes.
if [ -f prisma/schema.prisma ]; then
  log "génération du client Prisma"
  npx prisma generate >/dev/null 2>&1 || log "génération impossible (ignoré)"

  if [ -n "${DATABASE_URL:-}" ] || grep -q '^DATABASE_URL=' .env 2>/dev/null; then
    log "application des migrations (base de développement)"
    npx prisma migrate deploy >/dev/null 2>&1 ||
      log "migrations impossibles sur la base de développement (ignoré)"
  fi

  # La base e2e est distincte : sans elle à jour, toute la suite Playwright
  # tombe sur des colonnes manquantes.
  e2e_url="$(grep -m1 '^DATABASE_URL_E2E=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  if [ -n "$e2e_url" ]; then
    log "application des migrations (base e2e)"
    DATABASE_URL="$e2e_url" npx prisma migrate deploy >/dev/null 2>&1 ||
      log "migrations impossibles sur la base e2e (ignoré)"
  fi
fi

log "prêt — $(git rev-parse --short HEAD 2>/dev/null || echo 'révision inconnue')"
