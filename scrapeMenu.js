// scrapeMenu.js
import puppeteer from 'puppeteer';
import fs from 'fs/promises';

const URL = 'https://amrod.co.za';
const OUTPUT_PATH = './menu2.json';

const scrapeMenu = async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 0 });

  // Try hover to reveal dynamic menu
  try {
    await page.hover('#main-navigation'); // this may need to be updated again
  } catch (e) {
    console.warn('Hover failed:', e.message);
  }

  // Give it some time to render
  await page.waitForTimeout(3000);

  const menuStructure = await page.evaluate(() => {
    const buildItems = (el, depth = 1) => {
      if (depth > 3) return [];
      const items = [];
      el.querySelectorAll(':scope > li').forEach(li => {
        const link = li.querySelector(':scope > a');
        if (!link) return;

        const title = link.innerText.trim();
        const url = link.getAttribute('href') || '#';

        const submenu = li.querySelector(':scope > ul');
        const children = submenu ? buildItems(submenu, depth + 1) : [];

        items.push({ title, type: 'HTTP', url, items: children });
      });
      return items;
    };

    const nav = document.querySelector('#main-navigation ul, nav ul');
    if (!nav) return [];
    return buildItems(nav);
  });

  const finalMenu = {
    title: 'Menu 2',
    handle: 'menu-2',
    items: menuStructure || [],
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(finalMenu, null, 2));
  await browser.close();

  console.log(`✅ Menu saved to ${OUTPUT_PATH}`);
};

scrapeMenu().catch(console.error);
