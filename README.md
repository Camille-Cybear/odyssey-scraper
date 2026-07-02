# Odyssey Scraper

Scraper personnel pour archiver tes quêtes/ateliers Odyssey avant fermeture du site.

## ✅ Ajusté en live (Claude Code, 2026-07-01)

Les deux valeurs hypothétiques ont été validées/corrigées après inspection du vrai site, et le
fonctionnement a été amélioré au passage :

1. **`URL_PATTERN`** = `/\/(quests|adventures)\/\d+$/` — les contenus sont `/quests/<id>` (quêtes)
   et `/adventures/<id>` (ateliers, simple habillage autour d'une quête). Mais surtout : le
   catalogue de `/quests` est rendu en JS (cartes MUI sans `<a>`), invisible pour un crawl de liens.
   `discover` interroge donc directement l'API REST de l'app (`api.wildcodeschool.com/api/v3`,
   token = valeur du cookie `_odyssey_api`) pour lister toutes les quêtes publiées, et le crawl
   ne sert plus qu'à ramasser les ateliers liés depuis le dashboard.
2. **`CONTENT_SELECTOR`** = `main` — confirmé (app React/MUI, classes CSS hashées inutilisables).
   Mais il n'est plus qu'un secours : l'API renvoie le **Markdown source** de chaque quête
   (`chapters[].content_translations.fr`), donc `scrape` récupère ce Markdown natif au lieu de
   convertir le DOM. Gère les quêtes multi-pages (1 chapitre = 1 page) et déduplique
   quête/atelier/expédition pointant vers le même contenu.

## Installation

```bash
npm install
npx playwright install chromium
```

## Utilisation (dans l'ordre)

### 1. Capture de session
```bash
npm run login
```
Une fenêtre s'ouvre → connecte-toi normalement sur Odyssey → une fois sur ton dashboard, reviens
dans le terminal et appuie sur Entrée. Ça crée `auth.json` (ne jamais commit ce fichier, il contient
tes cookies de session).

### 2. Découverte des URLs
```bash
npm run discover
```
Crawl tous les liens internes accessibles depuis ton compte et sauvegarde les URLs de contenu dans
`urls.json`. **Relis ce fichier** et supprime ce qui n'est pas pertinent avant l'étape 3.

### 3. Extraction du contenu
```bash
npm run scrape
```
Pour chaque URL dans `urls.json` : extrait le contenu en Markdown + télécharge les images, dans `output/`.

## Résultat

```
output/
  quete-html-css-bases.md
  atelier-responsive-design.md
  assets/
    quete-html-css-bases/
      img-0.jpg
      img-1.png
```

Chaque `.md` a un frontmatter (`title`, `source`, `scraped_at`) compatible avec un import direct
dans Obsidian.

## Notes

- `auth.json` expire probablement après un moment — relance `npm run login` si `discover`/`scrape`
  échouent avec des redirections vers la page de connexion.
- Le crawl est volontairement sans parallélisation pour rester poli avec le serveur — avec
  quelques dizaines de pages ça reste rapide.
- Pense à ajouter `auth.json`, `node_modules/`, et `output/` à un `.gitignore` si tu commits ce dossier.
