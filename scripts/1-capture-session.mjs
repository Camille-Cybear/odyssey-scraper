import { chromium } from "playwright";

const AUTH_FILE = "auth.json";

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://odyssey.wildcodeschool.com/");

  console.log("\n👉 Connecte-toi manuellement dans la fenêtre qui vient de s'ouvrir.");
  console.log("   Une fois arrivé sur ton dashboard (contenu visible), reviens ici et appuie sur Entrée.\n");

  await new Promise((resolve) => {
    process.stdin.once("data", resolve);
  });

  await context.storageState({ path: AUTH_FILE });
  console.log(`✅ Session sauvegardée dans ${AUTH_FILE}`);

  await browser.close();
  process.exit(0);
})();
