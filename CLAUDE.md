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
US -> En tant qu'utilisateur, je doit pouvoir ajouter une image RAW sur le site facilement
Critères d'acceptation : 
- Je dois pouvoir glisser/déposer une image RAW
- Je dois pouvoir visualiser un apercu de l'image une fois qu'elle est ajouté au site
- Les formats acceptés sont : `.ARW`, `.CR3`, `.DNG`, `.NEF`, `.RAF`
- Afficher un message d'erreur si ce n'est un fichier raw
- En cas d'erreur, un message explicite s'affiche avec une suggestion d'action ("Réessayer" ou "Changer de photo")
- Un bouton d'envoi est disponible sous l'upload
- Un indicateur de chargement s'affiche entre le dépôt du fichier et la fin de la conversion


 US -> En tant qu'utilisateur, je veux etre informer quand ma photo est prête à etre analysée
- Le bouton d'envoi est désactivé pendant l'extraction EXIF et la conversion de l'image
- Un toast de confirmation s'affiche quand la photo est prête à etre envoyé
- Le toast disparait après quelque seconde
- L'indicateur affiche l'étape en cours : "Lecture de la photo", "Préparation de l'analyse", "Analyse en cours"

### Release 2 — Analyse IA
US -> En tant qu'utilisateur je veux recevoir une analyse de l'IA sur sa photo, afin de comprendre les points forts et savoir comment ameliorer la composition, lumière, et donner une idée de direction de retouche
Critères d'acceptation : 
- L'analyse couvre la lumière, la compositions, les axes d'améliorations
- Les métadonnées paramètre de la photo et le sujet de l'image dans un premier temps.
- L'IA identifie le type de photo et le sujet photographié
- Les conseils sont liés au type de la photo
- Une fenêtre avec le retour de l'IA doit apparaitre dynamiquement sans recharger.
- Un indicateur doit informer que l'IA est en train d'analyser la photo
- Afficher le retour que ce soit une erreur ou une analyse reussi

### Release 3 — Nouvelle analyse
US -> En tant que photographe, je veux pouvoir analyser une autre photo sans recharger la page, afin d'enchaîner les analyses facilement.

Critères d'acceptation :

- Un bouton "Nouvelle photo" remet l'interface à zéro
- L'ancien résultat disparaît proprement
- Le bouton d'envoi repasse à l'état désactivé

## Contraintes techniques

- Claude n'accepte pas les RAW natifs → toujours convertir via `sharp` avant envoi
- Le preview JPEG embarqué dans le RAW suffit pour l'analyse visuelle
- `ANTHROPIC_API_KEY` uniquement dans `.env` côté serveur, jamais exposée au front
