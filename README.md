# PhotoAssist

Assistant IA d'analyse de photos automobiles. Déposez un fichier RAW, recevez une analyse experte : lumière, composition, direction de retouche et score — le tout alimenté par Claude (Anthropic).

## Fonctionnalités

- **Upload RAW** par glisser-déposer — formats `.ARW`, `.CR3`, `.DNG`, `.NEF`, `.RAF`
- **Aperçu automatique** extrait du fichier RAW (preview JPEG embarqué, redimensionné à 1920px)
- **Analyse IA** via Claude Vision avec les métadonnées EXIF (ISO, vitesse, ouverture, focale, appareil)
- **Détection du style photographique** — rolling shot, freeze, statique, studio, macro, etc. — pour un retour adapté au contexte créatif
- **Direction de retouche** — style, colorimétrie, exposition, finition
- **Téléchargement** de l'analyse au format Markdown

## Stack

- [SvelteKit](https://kit.svelte.dev) + Svelte 5 (Runes) + TypeScript
- [Anthropic Claude](https://anthropic.com) — vision + analyse IA
- [sharp](https://sharp.pixelplumbing.com) — redimensionnement et correction d'orientation du JPEG embarqué
- [exifr](https://github.com/MikeKovarik/exifr) — extraction des métadonnées EXIF

## Prérequis

- **Node.js** 18 ou supérieur
- **Clé API Anthropic** — obtenir sur [console.anthropic.com](https://console.anthropic.com/settings/keys)

## Installation

```bash
# 1. Cloner le dépôt
git clone <url-du-repo>
cd photoAssist

# 2. Installer les dépendances
npm install

# 3. Configurer la clé API
cp .env.example .env
# Ouvrir .env et renseigner ANTHROPIC_API_KEY
```

Contenu du fichier `.env` :

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

> La clé API ne doit jamais être committée. Le fichier `.env` est dans `.gitignore`.

## Démarrage

```bash
npm run dev
```

L'application est accessible sur [http://localhost:5173](http://localhost:5173).

## Scripts disponibles

| Commande | Description |
|---|---|
| `npm run dev` | Serveur de développement avec HMR |
| `npm run build` | Build de production |
| `npm run preview` | Prévisualiser le build de production |
| `npm run test` | Lancer les tests (Vitest) |
| `npm run test:watch` | Tests en mode watch |
| `npm run check` | Vérification TypeScript |

## Utilisation

1. Glissez-déposez un fichier RAW sur la zone d'upload (ou cliquez pour parcourir)
2. Attendez l'extraction du preview et des métadonnées EXIF
3. Cliquez sur **Analyser** — le panneau latéral s'ouvre avec les étapes en temps réel
4. Consultez l'analyse : sujet, lumière, composition, axes d'amélioration, direction de retouche
5. Téléchargez l'analyse au format `.md` si besoin

## Formats RAW supportés

| Format | Fabricant |
|---|---|
| `.ARW` | Sony |
| `.CR3` | Canon |
| `.DNG` | Adobe / universel |
| `.NEF` | Nikon |
| `.RAF` | Fujifilm |

## Structure du projet

```
src/
├── routes/
│   ├── +page.svelte              # Interface principale
│   └── api/
│       └── analyze/
│           ├── +server.ts        # Endpoint SSE → appel Claude
│           └── preview/
│               └── +server.ts    # Extraction JPEG + métadonnées EXIF
```

## Coût API

Avec le modèle `claude-sonnet-4-6` (défaut) :

- ~**1–2 centimes** par analyse (image 1920px + métadonnées + réponse JSON)
- Les $5 de crédits gratuits Anthropic couvrent ~300–500 analyses

Pour réduire les coûts en développement, remplacer dans `src/routes/api/analyze/+server.ts` :
```ts
model: 'claude-haiku-4-5-20251001'  // ~5× moins cher
```
