import { chromium } from "playwright";
import fs from "node:fs";

const AUTH_FILE = "auth.json";
const BASE = "https://odyssey.wildcodeschool.com";
const API = "https://api.wildcodeschool.com/api/v3";

const START_URL = `${BASE}/`; // dashboard : liens directs vers tes ateliers/aventures de promo
const MAX_DEPTH = 2;
// Motif validé en live : les pages de contenu sont /quests/<id> et /adventures/<id> (ateliers).
// Anchoré en fin d'URL pour exclure /quests/<id>/solutions, /pages/<id>/feedback, etc.
const URL_PATTERN = /\/(quests|adventures)\/\d+$/;

// Le catalogue de /quests est rendu en JS (cartes MUI sans <a>) : invisible pour un crawl de liens.
// L'app parle à une API REST dont le token est la valeur du cookie _odyssey_api — on l'utilise
// pour lister TOUTES les quêtes publiées, et le crawl ne sert plus qu'aux aventures du dashboard.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripFragment(href) {
  const u = new URL(href);
  return u.origin + u.pathname.replace(/\/$/, "");
}

(async () => {
  const auth = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
  const token = auth.cookies.find((c) => c.name === "_odyssey_api")?.value;
  if (!token) {
    console.error("❌ Cookie _odyssey_api introuvable dans auth.json — relance `npm run login`.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false }); // false = tu peux observer le crawl
  const context = await browser.newContext({ storageState: AUTH_FILE });
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const found = new Set();

  // --- 1) Catalogue complet des quêtes via l'API ---
  let apiPage = 1;
  let total = Infinity;
  let fetched = 0;
  while (fetched < total) {
    const res = await context.request.get(
      `${API}/quests?page=${apiPage}&per_page=100&published=true`,
      { headers }
    );
    if (!res.ok()) {
      console.warn(`⚠️ API quests page ${apiPage}: HTTP ${res.status()} — session expirée ? Relance \`npm run login\`.`);
      break;
    }
    const data = await res.json();
    total = data.total;
    for (const q of data.quests) found.add(`${BASE}/quests/${q.id}`);
    fetched += data.quests.length;
    if (!data.quests.length) break;
    apiPage++;
    await sleep(400);
  }
  console.log(`📚 API : ${found.size} quêtes publiées trouvées (total annoncé : ${total})`);

  // --- 2) Crawl léger depuis le dashboard pour les ateliers/aventures de ta promo ---
  const visited = new Set();
  const toVisit = [{ url: START_URL, depth: 0 }];
  const page = await context.newPage();

  while (toVisit.length) {
    const { url, depth } = toVisit.shift();
    if (visited.has(url) || depth > MAX_DEPTH) continue;
    visited.add(url);

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(500); // laisser le temps au JS de rendre le contenu

      const links = await page.$$eval("a[href]", (as) => as.map((a) => a.href));

      for (const link of links) {
        if (!link.startsWith(BASE)) continue;
        const clean = stripFragment(link); // les pages sont truffées d'ancres #section → dédupliquer
        if (URL_PATTERN.test(clean)) found.add(clean);
        if (!visited.has(clean)) toVisit.push({ url: clean, depth: depth + 1 });
      }
      console.log(`Exploré: ${url} (${found.size} pages de contenu trouvées jusqu'ici)`);
    } catch (e) {
      console.warn(`⚠️ Erreur sur ${url}: ${e.message}`);
    }
  }

  fs.writeFileSync("urls.json", JSON.stringify([...found].sort(), null, 2));
  console.log(`\n✅ ${found.size} URLs sauvegardées dans urls.json`);
  console.log("   → Relis le fichier et supprime ce qui n'est pas pertinent avant l'étape 3.");

  await browser.close();
  process.exit(0);
})();
