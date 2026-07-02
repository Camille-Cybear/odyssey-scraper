import { chromium } from "playwright";
import TurndownService from "turndown";
import fs from "node:fs";
import path from "node:path";

const AUTH_FILE = "auth.json";
const OUTPUT_DIR = "output";
const BASE = "https://odyssey.wildcodeschool.com";
const API = "https://api.wildcodeschool.com/api/v3";

// Sélecteur validé en live : app React/MUI, tout le contenu d'une page est dans <main>
// (les classes CSS sont hashées, ex. main.css-f1mnc0 — inutilisables, "main" est le bon choix).
// N'est utilisé qu'en SECOURS : pour les quêtes/aventures, l'API renvoie directement le
// Markdown source (chapters[].content_translations), bien plus propre que du DOM converti.
const CONTENT_SELECTOR = "main";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function pickTranslation(translations) {
  if (!translations) return null;
  return translations.fr ?? Object.values(translations)[0] ?? null;
}

(async () => {
  const urls = JSON.parse(fs.readFileSync("urls.json", "utf-8"));
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
  const token = auth.cookies.find((c) => c.name === "_odyssey_api")?.value;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: AUTH_FILE });
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const scrapedQuestIds = new Set(); // un atelier pointe vers une quête → éviter les doublons
  const usedSlugs = new Set(); // deux quêtes peuvent porter le même titre → suffixer l'id

  function uniqueSlug(base, suffix) {
    let slug = base;
    if (usedSlugs.has(slug)) slug = `${base}-${suffix}`;
    usedSlugs.add(slug);
    return slug;
  }

  async function getJson(url) {
    const res = await context.request.get(url, { headers });
    if (!res.ok()) throw new Error(`HTTP ${res.status()} sur ${url}`);
    return res.json();
  }

  async function downloadImages(markdown, slug) {
    const assetsDir = path.join(OUTPUT_DIR, "assets", slug);
    const srcs = [...new Set([...markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]))];
    if (srcs.length) fs.mkdirSync(assetsDir, { recursive: true });
    for (const [i, src] of srcs.entries()) {
      try {
        const res = await context.request.get(src);
        if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
        const buffer = await res.body();
        const ext = path.extname(new URL(src).pathname) || ".jpg";
        const filename = `img-${i}${ext}`;
        fs.writeFileSync(path.join(assetsDir, filename), buffer);
        markdown = markdown.split(src).join(`./assets/${slug}/${filename}`);
      } catch (e) {
        console.warn(`  ⚠️ Échec téléchargement image ${src}: ${e.message}`);
      }
    }
    return markdown;
  }

  function writeMd({ slug, title, sourceUrl, extra = {}, markdown }) {
    const extraLines = Object.entries(extra).map(([k, v]) => `${k}: ${v}`).join("\n");
    const frontmatter = `---
title: "${title.replace(/"/g, '\\"')}"
source: ${sourceUrl}
${extraLines ? extraLines + "\n" : ""}scraped_at: ${new Date().toISOString()}
---

`;
    fs.writeFileSync(path.join(OUTPUT_DIR, `${slug}.md`), frontmatter + markdown);
    console.log(`✅ ${slug}.md`);
    return slug;
  }

  async function scrapeQuest(questId, sourceUrl) {
    if (scrapedQuestIds.has(questId)) {
      console.log(`⏭️  Quête ${questId} déjà extraite (doublon quête/atelier), on passe.`);
      return;
    }
    const quest = await getJson(`${API}/quests/${questId}`);
    scrapedQuestIds.add(questId);

    const title = pickTranslation(quest.title_translations) || `quete-${questId}`;
    const parts = [];
    for (const chapter of quest.chapters || []) {
      const chapterTitle = pickTranslation(chapter.title_translations);
      const content = pickTranslation(chapter.content_translations);
      if (chapterTitle) parts.push(`# ${chapterTitle}`);
      if (content) parts.push(content);
      else if (!chapterTitle) parts.push(`> _[chapitre de type « ${chapter.chapter_type} » sans contenu textuel]_`);
    }
    let markdown = parts.join("\n\n---\n\n");

    const slug = uniqueSlug(slugify(title) || `quete-${questId}`, questId);
    markdown = await downloadImages(markdown, slug);

    writeMd({
      slug,
      title,
      sourceUrl,
      extra: {
        quest_id: questId,
        topic: pickTranslation(quest.topic?.name_translations) || "",
      },
      markdown,
    });
  }

  // Secours DOM pour les URLs qui ne sont ni des quêtes ni des ateliers
  async function scrapeDom(url) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(500);

      const title = await page.title();
      const html = await page.$eval(CONTENT_SELECTOR, (el) => el.innerHTML).catch(() => null);
      if (!html) {
        console.warn(`⚠️ Pas de contenu trouvé sur ${url} avec le sélecteur "${CONTENT_SELECTOR}"`);
        return;
      }
      const slug = uniqueSlug(slugify(title) || slugify(url), Date.now());
      let markdown = turndown.turndown(html);
      markdown = await downloadImages(markdown, slug);
      writeMd({ slug, title, sourceUrl: url, markdown });
    } finally {
      await page.close();
    }
  }

  for (const url of urls) {
    try {
      const questMatch = url.match(/\/quests\/(\d+)$/);
      const adventureMatch = url.match(/\/adventures\/(\d+)$/);

      if (questMatch) {
        await scrapeQuest(Number(questMatch[1]), url);
      } else if (adventureMatch) {
        // un atelier/aventure n'est qu'un habillage autour d'une quête
        const adventure = await getJson(`${API}/adventures/${adventureMatch[1]}`);
        if (adventure.quest?.id) await scrapeQuest(adventure.quest.id, url);
        else console.warn(`⚠️ Aventure ${adventureMatch[1]} sans quête associée ?`);
      } else {
        await scrapeDom(url);
      }
      await sleep(400); // rester poli avec le serveur
    } catch (e) {
      console.warn(`⚠️ Erreur sur ${url}: ${e.message}`);
    }
  }

  await browser.close();
  console.log("\n🎉 Terminé. Contenu dans ./output/");
  process.exit(0);
})();
