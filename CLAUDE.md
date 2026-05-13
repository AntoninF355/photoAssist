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

## Objectif métier du MVP

> Devenir l'outil de référence pour l'auto-formation en photographie automobile, en réduisant le temps entre la prise de vue et le feedback expert de plusieurs jours à quelques secondes.

Les releases 1, 2 et 3 posent les fondations (upload, analyse, reset). Les releases suivantes transforment l'outil en compagnon de progression sur la durée.

## User Stories — Release 4 et au-delà

### Release 4 — Historique des analyses (US-A1)

US -> En tant que photographe, je veux retrouver mes analyses précédentes sans les avoir téléchargées, afin de suivre ma progression dans le temps.

Critères d'acceptation :
- Les analyses sont sauvegardées automatiquement en localStorage après chaque résultat reçu
- Un panneau "Historique" liste les analyses passées (miniature, sujet, score, date)
- Je peux cliquer sur une entrée pour revoir le détail complet de l'analyse
- Je peux supprimer une entrée de l'historique
- L'historique persiste après fermeture et réouverture du navigateur
- Si l'historique est vide, un message d'invitation s'affiche ("Analysez votre première photo")
- Le stockage est limité à 20 entrées maximum (les plus anciennes sont supprimées automatiquement)

### Release 5 — Analyse en lot (US-B1)

US -> En tant que photographe, je veux soumettre plusieurs photos RAW d'un même shoot en une seule fois, afin d'identifier rapidement les meilleures sans analyser manuellement chaque image.

Critères d'acceptation :
- La zone de dépôt accepte plusieurs fichiers simultanément (jusqu'à 10)
- Une file d'attente affiche les fichiers en attente d'analyse avec leur statut (en attente, en cours, terminé, erreur)
- Les analyses s'exécutent séquentiellement (une à la fois) pour éviter la surcharge API
- Un indicateur de progression global s'affiche (ex : "3 / 7 analysées")
- À la fin du lot, les photos sont classées automatiquement par score décroissant
- Je peux télécharger un rapport récapitulatif en markdown listant toutes les analyses du lot
- Une analyse en erreur ne bloque pas les suivantes

### Release 6 — Export rapport PDF (US-B2)

US -> En tant que photographe, je veux exporter l'analyse d'une photo sous forme de rapport PDF illustré, afin de le partager avec un client ou de le conserver dans mon dossier de projet.

Critères d'acceptation :
- Un bouton "Exporter en PDF" est disponible une fois l'analyse affichée
- Le PDF contient : l'aperçu de la photo, le score, le type de photo, l'analyse lumière, la composition, les axes d'amélioration et la direction de retouche
- Le nom du fichier PDF reprend le nom de la photo originale (ex : `analyse-DSC_0042.pdf`)
- La mise en page est lisible et imprimable (pas de fond noir)
- Le PDF est généré côté client (pas de requête serveur supplémentaire)

### Release 7 — Mode défi (US-C1)

US -> En tant que photographe souhaitant progresser sur un style précis, je veux soumettre une photo en indiquant le style visé, afin de recevoir une analyse calibrée sur ce style plutôt que sur le style détecté automatiquement.

Critères d'acceptation :
- Avant d'envoyer la photo, je peux sélectionner un "style cible" parmi : Rolling shot, Panning, Freeze / circuit, Statique extérieur, Studio, Détail / macro, Drift, Aérien
- Le style sélectionné est transmis au backend et injecté dans le prompt
- L'IA évalue la photo exclusivement selon les critères du style cible (pas de détection automatique)
- Le résultat affiche clairement le style cible choisi et précise si la photo "relève le défi" ou non
- Si aucun style n'est sélectionné, le comportement actuel (détection automatique) s'applique

## Contraintes techniques

- Claude n'accepte pas les RAW natifs → toujours convertir via `sharp` avant envoi
- Le preview JPEG embarqué dans le RAW suffit pour l'analyse visuelle
- `ANTHROPIC_API_KEY` uniquement dans `.env` côté serveur, jamais exposée au front
- localStorage pour la persistance côté client (pas de base de données pour le MVP)
- Génération PDF côté client uniquement (ex : `jsPDF` ou `@react-pdf` équivalent Svelte) pour éviter un endpoint supplémentaire
