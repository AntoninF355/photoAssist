# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Start development server with HMR
npm run build         # Production build
npm run preview       # Preview production build
npm run check         # Type-check with svelte-check
npm run check:watch   # Type-check in watch mode
npm run test          # Run tests (one shot)
npm run test:watch    # Run tests in watch mode
```

Tests colocalisés dans `src/routes/` (ex: `+page.test.ts` à côté de `+page.svelte`). Setup jest-dom dans `src/setupTests.ts`.

## Projet

Assistant photo automobile IA : un photographe uploade une photo RAW et reçoit une analyse experte via Claude (lumière, composition, métadonnées EXIF, axes d'amélioration, score /10).

Projet de cours évalué sur le **workflow IA**, le **TDD** (tests écrits avant le code), et des commits propres et réguliers.

## Architecture

The project uses a **use-case-per-folder** structure inside feature modules. Each use case lives in its own subfolder with dedicated files:

**Key conventions:**
- All routes are prefixed with `/api` (except root `/`)

**Stack :** SvelteKit + Svelte 5 (Runes) + TypeScript full-stack, un seul projet.

**Structure :**
```
src/
├── routes/
│   ├── +page.svelte         ← interface drag & drop + résultat
│   └── api/analyze/
│       └── +server.ts       ← pipeline complet
└── lib/
```

**Pipeline backend (`src/routes/api/analyze/+server.ts`) :**
```
RAW reçu → exifr (ISO, vitesse, ouverture, focale, appareil)
         → sharp (extrait le preview JPEG embarqué dans le RAW)
         → prompt enrichi : image base64 + métadonnées
         → Claude API vision
         → feedback structuré renvoyé au front
```

**Dépendances clés :**
- `@anthropic-ai/sdk` — appel Claude vision (clé dans `.env`, jamais exposée au front)
- `sharp` — extraction du preview JPEG embarqué dans le RAW (Claude n'accepte pas les RAW natifs)
- `exifr` — extraction EXIF (ISO, vitesse, ouverture, focale, appareil)

**Svelte 5 Runes** activé globalement dans `svelte.config.js` — utiliser `$state`, `$derived`, `$effect`.

## User Stories par release

### Release 1 — Upload et préparation
- Drag & drop d'une image RAW (`.ARW`, `.CR3`, `.DNG`, `.NEF`, `.RAF`) avec aperçu
- Message d'erreur explicite + action suggérée si format invalide
- Bouton d'envoi désactivé pendant l'extraction EXIF/conversion
- Indicateur de progression avec étapes : "Lecture de la photo" → "Préparation de l'analyse" → "Analyse en cours"
- Toast de confirmation quand la photo est prête, disparaît après quelques secondes

### Release 2 — Analyse IA
- L'analyse couvre : lumière, composition, métadonnées/paramètres, identification du sujet et type de photo, axes d'amélioration
- Les conseils sont adaptés au type de photo identifié
- Résultat affiché dynamiquement sans rechargement (succès ou erreur)
- Indicateur pendant l'analyse IA

### Release 3 — Nouvelle analyse
- Bouton "Nouvelle photo" remet l'interface à zéro (résultat effacé, bouton d'envoi désactivé)

## Contraintes techniques

- Claude n'accepte pas les RAW natifs → toujours convertir via `sharp` avant envoi
- Le preview JPEG embarqué dans le RAW suffit pour l'analyse visuelle
- `ANTHROPIC_API_KEY` uniquement dans `.env` côté serveur, jamais exposée au front
