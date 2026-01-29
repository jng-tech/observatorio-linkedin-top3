/**
 * fetch_top3.mjs
 *
 * Extrae posts de LinkedIn usando sesión persistida y genera public/data.json
 * con el top 3 por interacciones (likes + comments + reposts).
 *
 * Uso: npm run fetch
 * Requisito: ejecutar primero npm run login
 *
 * Exit codes:
 *   0 = éxito
 *   1 = error general (sesión no existe, etc.)
 *   2 = sesión expirada / checkpoint detectado
 */

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

const STATE_PATH = 'state/linkedin.json';
const OUTPUT_PATH = 'public/data.json';
const DEBUG_DIR = 'debug';

/**
 * Hashtags seleccionados (ESG x Tech):
 * - esg: Environmental, Social, Governance - término paraguas
 * - climatetech: tecnología para combatir el cambio climático
 * - sustainability: sostenibilidad general, muy activo en LinkedIn
 */
const HASHTAGS = ['esg', 'climatetech', 'sustainability'];

// URL de búsqueda fallback si hashtags no dan suficientes posts
const SEARCH_FALLBACK_URL =
  'https://www.linkedin.com/search/results/content/?keywords=esg%20climatetech%20sustainability';

// Configuración de scraping - AUMENTADO para mayor cobertura
const SCROLL_COUNT = 10;       // Número de scrolls por hashtag/búsqueda
const SCROLL_DELAY = 1500;     // ms entre scrolls
const CARDS_PER_SOURCE = 60;   // Máximo de cards a procesar por fuente

// Mínimo de posts únicos deseados
const MIN_POSTS_DESIRED = 3;

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN COMPARTIDA (debe coincidir con login_once.mjs)
// ─────────────────────────────────────────────────────────────────────────────

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const VIEWPORT = { width: 1280, height: 900 };

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS "SAFE" (evitan crash si la página se cierra)
// ─────────────────────────────────────────────────────────────────────────────

async function safeTitle(page) {
  try {
    if (!page || page.isClosed()) return '';
    return (await page.title()) || '';
  } catch {
    return '';
  }
}

function safeUrl(page) {
  try {
    if (!page || page.isClosed()) return '';
    return page.url() || '';
  } catch {
    return '';
  }
}

async function safeQueryAll(page, selector) {
  try {
    if (!page || page.isClosed()) return [];
    return await page.$$(selector);
  } catch {
    return [];
  }
}

async function safeContent(page) {
  try {
    if (!page || page.isClosed()) return '';
    return await page.content();
  } catch {
    return '';
  }
}

async function safeScreenshot(page, path) {
  try {
    if (!page || page.isClosed()) return false;
    await page.screenshot({ path, fullPage: false });
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

function parseNumber(text) {
  if (!text) return 0;

  const cleaned = text.replace(/[^\d.,kKmM]/g, '').replace(',', '.').trim();
  if (!cleaned) return 0;

  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!match) return parseInt(cleaned, 10) || 0;

  const num = parseFloat(match[1]);
  const suffix = (match[2] || '').toLowerCase();

  if (suffix === 'k') return Math.round(num * 1000);
  if (suffix === 'm') return Math.round(num * 1000000);
  return Math.round(num);
}

function cleanSnippet(text, maxLen = 240) {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen).trim() + '...';
}

function extractNumberFromAriaLabel(ariaLabel) {
  if (!ariaLabel) return 0;
  const match = ariaLabel.match(/[\d,.]+/);
  if (!match) return 0;
  return parseNumber(match[0]);
}

/**
 * Normaliza URL quitando query params para deduplicación
 */
function normalizeUrl(url) {
  if (!url) return '';
  return url.split('?')[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECCIÓN DE LOGIN/CHECKPOINT (CRÍTICO)
// ─────────────────────────────────────────────────────────────────────────────

async function isOnLoginOrCheckpoint(page) {
  if (!page || page.isClosed()) return true;

  const url = safeUrl(page).toLowerCase();
  const title = (await safeTitle(page)).toLowerCase();

  // URL heuristics
  if (
    url.includes('/login') ||
    url.includes('/checkpoint') ||
    url.includes('/authwall') ||
    url.includes('/uas/') ||
    url.includes('signin')
  ) return true;

  // Title heuristics
  if (
    title.includes('iniciar sesión') ||
    title.includes('sign in') ||
    title.includes('log in') ||
    title.includes('login') ||
    title.includes('checkpoint')
  ) return true;

  // DOM heuristics (wrapped)
  const loginForms = await safeQueryAll(
    page,
    'form[action*="checkpoint"], form[action*="login"], form[action*="uas"], #login-form'
  );
  if (loginForms.length > 0) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNÓSTICO Y DEBUG
// ─────────────────────────────────────────────────────────────────────────────

async function printDiagnostics(page, source) {
  const url = safeUrl(page);
  const title = await safeTitle(page);

  console.log('\n   ┌── DIAGNÓSTICO ──────────────────────────────────');
  console.log(`   │ Fuente: ${source}`);
  console.log(`   │ URL actual: ${url || '(desconocida / page closed)'}`);
  console.log(`   │ Título: ${title || '(desconocido / page closed)'}`);

  const selectorList = [
    'div.feed-shared-update-v2',
    'div[data-urn*="urn:li:activity:"]',
    'article',
    'div.occludable-update',
  ];

  for (const sel of selectorList) {
    const els = await safeQueryAll(page, sel);
    console.log(`   │ ${sel}: ${els.length} elementos`);
  }
  console.log('   └──────────────────────────────────────────────────');
}

async function saveDebugFiles(page, source, reason) {
  try {
    await mkdir(DEBUG_DIR, { recursive: true });

    const url = safeUrl(page);
    const title = await safeTitle(page);
    const safeName = source.replace(/[^a-zA-Z0-9]/g, '_');

    // Guardar HTML (solo si page no está cerrada)
    const html = await safeContent(page);
    if (html) {
      const htmlPath = `${DEBUG_DIR}/${safeName}.html`;
      await writeFile(htmlPath, html, 'utf8');
      console.log(`   💾 Debug HTML: ${htmlPath}`);
    } else {
      console.log(`   ⚠️ No se guardó HTML (page closed o sin content)`);
    }

    // Guardar screenshot (best-effort)
    const screenshotPath = `${DEBUG_DIR}/${safeName}.png`;
    const okShot = await safeScreenshot(page, screenshotPath);
    if (okShot) console.log(`   📸 Debug screenshot: ${screenshotPath}`);
    else console.log(`   ⚠️ No se pudo guardar screenshot (page closed)`);

    console.log(`   📝 Razón: ${reason}`);
    if (url) console.log(`   🔎 URL: ${url}`);
    if (title) console.log(`   🔎 Title: ${title}`);
  } catch (err) {
    console.log(`   ⚠️ No se pudo guardar debug: ${err?.message || String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRAPING GENÉRICO (usado para hashtags y búsqueda)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Navega a una URL, hace scroll, y extrae posts
 * @param {Page} page - Página de Playwright
 * @param {string} url - URL a visitar
 * @param {string} source - Nombre de la fuente (para logs y keyword)
 * @param {Set<string>} seenUrls - URLs ya vistas (para deduplicar)
 * @returns {{ posts: Array, checkpointDetected: boolean }}
 */
async function scrapePage(page, url, source, seenUrls) {
  console.log(`\n📍 Navegando a: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    console.log(`   ⚠️ Error cargando página: ${err?.message || String(err)}`);
    return { posts: [], checkpointDetected: false };
  }

  await page.waitForTimeout(3000);

  // URL final (por si hubo redirect)
  console.log(`   📍 URL final: ${safeUrl(page)}`);

  // Detect checkpoint/login
  if (await isOnLoginOrCheckpoint(page)) {
    console.log('\n   ❌ CHECKPOINT/LOGIN DETECTADO');
    console.log('   La sesión ha expirado o LinkedIn requiere verificación.');
    await saveDebugFiles(page, source, 'checkpoint_detected');
    return { posts: [], checkpointDetected: true };
  }

  // Scroll más agresivo
  console.log(`   Haciendo scroll (${SCROLL_COUNT}x)...`);
  for (let i = 0; i < SCROLL_COUNT; i++) {
    try {
      if (page.isClosed()) break;
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(SCROLL_DELAY);
    } catch {}
  }
  await page.waitForTimeout(1000);

  // Diagnóstico
  await printDiagnostics(page, source);

  // Estrategias de cards
  const cardStrategies = [
    { selector: 'div[data-urn*="urn:li:activity:"]', name: 'data-urn activity' },
    { selector: 'div.occludable-update', name: 'occludable-update' },
    { selector: 'div.feed-shared-update-v2', name: 'feed-shared-update-v2' },
    { selector: 'article', name: 'article' },
  ];

  let cards = [];
  let usedStrategy = '';

  for (const strategy of cardStrategies) {
    cards = await safeQueryAll(page, strategy.selector);
    if (cards.length > 0) {
      usedStrategy = strategy.name;
      console.log(`   ✓ Usando estrategia: ${strategy.name} (${cards.length} cards)`);
      break;
    }
  }

  if (cards.length === 0) {
    console.log('   ⚠️ No se encontraron cards con ninguna estrategia');
    await saveDebugFiles(page, source, 'no_cards_found');
    return { posts: [], checkpointDetected: false };
  }

  const posts = [];
  const cardsToProcess = cards.slice(0, CARDS_PER_SOURCE);

  for (const card of cardsToProcess) {
    try {
      const post = await extractPostData(card, source);
      if (post && post.url) {
        const normalized = normalizeUrl(post.url);
        // Solo añadir si no está ya visto
        if (!seenUrls.has(normalized)) {
          seenUrls.add(normalized);
          posts.push(post);
        }
      }
    } catch {}
  }

  console.log(`   ✓ Extraídos ${posts.length} posts nuevos (únicos)`);

  if (posts.length === 0 && cards.length > 0) {
    await saveDebugFiles(page, source, 'cards_found_but_no_new_posts_extracted');
  }

  return { posts, checkpointDetected: false };
}

async function extractPostData(card, source) {
  // URL
  const allLinks = await card.$$('a[href]');
  let url = null;

  for (const link of allLinks) {
    const href = await link.getAttribute('href').catch(() => null);
    if (href && (
      href.includes('/feed/update/') ||
      href.includes('/posts/') ||
      href.includes('urn:li:activity')
    )) {
      url = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
      break;
    }
  }
  if (!url) return null;

  // Autor
  const authorSelectors = [
    'span.update-components-actor__name',
    'span.feed-shared-actor__name',
    '.update-components-actor__title span[aria-hidden="true"]',
    '.feed-shared-actor__title span[aria-hidden="true"]',
    'a.app-aware-link span[dir="ltr"]',
    '.update-components-actor__name span',
    'span.hoverable-link-text',
  ];

  let author = '';
  for (const selector of authorSelectors) {
    try {
      const el = await card.$(selector);
      if (!el) continue;
      const text = await el.innerText().catch(() => '');
      const t = (text || '').trim();
      if (t.length > 1) { author = t.split('\n')[0].trim(); break; }
    } catch {}
  }

  // Snippet
  const textSelectors = [
    'div.update-components-text',
    'div.feed-shared-update-v2__description',
    'span.break-words',
    '.feed-shared-text',
    'div.feed-shared-text',
    '.update-components-text span[dir="ltr"]',
  ];

  let snippet = '';
  for (const selector of textSelectors) {
    try {
      const el = await card.$(selector);
      if (!el) continue;
      const text = await el.innerText().catch(() => '');
      if (text && text.trim().length > 20) { snippet = cleanSnippet(text); break; }
    } catch {}
  }

  if (!snippet) {
    try {
      const cardText = await card.innerText().catch(() => '');
      if (cardText) snippet = cleanSnippet(cardText);
    } catch {}
  }

  // Likes
  let likes = 0;
  const likesSelectors = [
    'button[aria-label*="reaction"]',
    'button[aria-label*="like"]',
    'button[aria-label*="Reaction"]',
    'button[aria-label*="Like"]',
    'span.social-details-social-counts__reactions-count',
    '.reactions-count',
  ];
  for (const selector of likesSelectors) {
    try {
      const el = await card.$(selector);
      if (!el) continue;
      const ariaLabel = await el.getAttribute('aria-label').catch(() => '');
      if (ariaLabel) {
        const extracted = extractNumberFromAriaLabel(ariaLabel);
        if (extracted > 0) { likes = extracted; break; }
      }
      const text = await el.innerText().catch(() => '');
      if (text) {
        const extracted = parseNumber(text);
        if (extracted > 0) { likes = extracted; break; }
      }
    } catch {}
  }

  // Comments
  let comments = 0;
  const commentsSelectors = [
    'button[aria-label*="comment"]',
    'button[aria-label*="Comment"]',
    'li.social-details-social-counts__comments button',
    '.comments-count',
  ];
  for (const selector of commentsSelectors) {
    try {
      const el = await card.$(selector);
      if (!el) continue;
      const ariaLabel = await el.getAttribute('aria-label').catch(() => '');
      if (ariaLabel) {
        const extracted = extractNumberFromAriaLabel(ariaLabel);
        if (extracted > 0) { comments = extracted; break; }
      }
      const text = await el.innerText().catch(() => '');
      if (text) {
        const extracted = parseNumber(text);
        if (extracted > 0) { comments = extracted; break; }
      }
    } catch {}
  }

  // Reposts
  let reposts = 0;
  const repostsSelectors = [
    'button[aria-label*="repost"]',
    'button[aria-label*="Repost"]',
    'button[aria-label*="share"]',
    'button[aria-label*="Share"]',
    'li.social-details-social-counts__shares button',
    '.shares-count',
  ];
  for (const selector of repostsSelectors) {
    try {
      const el = await card.$(selector);
      if (!el) continue;
      const ariaLabel = await el.getAttribute('aria-label').catch(() => '');
      if (ariaLabel) {
        const extracted = extractNumberFromAriaLabel(ariaLabel);
        if (extracted > 0) { reposts = extracted; break; }
      }
      const text = await el.innerText().catch(() => '');
      if (text) {
        const extracted = parseNumber(text);
        if (extracted > 0) { reposts = extracted; break; }
      }
    } catch {}
  }

  const total = likes + comments + reposts;

  // Determinar keyword basado en fuente
  let keyword = source;
  if (source.startsWith('#')) {
    keyword = source;
  } else if (source === 'search_fallback') {
    keyword = '#esg+climatetech+sustainability';
  }

  return {
    url,
    author: author || '',
    title: author || 'Publicación LinkedIn',
    snippet,
    likes,
    comments,
    reposts,
    total,
    keyword,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         FETCH TOP 3 LINKEDIN (ESG x Tech)                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (!existsSync(STATE_PATH)) {
    console.error(`\n❌ No existe ${STATE_PATH}`);
    console.error('   Ejecuta primero: npm run login\n');
    process.exit(1);
  }

  console.log(`\n📂 Usando sesión: ${STATE_PATH}`);
  console.log(`🏷️  Hashtags: ${HASHTAGS.map(h => '#' + h).join(', ')}`);
  console.log(`🔍 Fallback: búsqueda de contenido si < ${MIN_POSTS_DESIRED} posts`);
  console.log(`📜 Scroll: ${SCROLL_COUNT}x por fuente, hasta ${CARDS_PER_SOURCE} cards`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  let wroteOutput = false;

  try {
    const context = await browser.newContext({
      storageState: STATE_PATH,
      userAgent: USER_AGENT,
      viewport: VIEWPORT,
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid',
    });

    const page = await context.newPage();

    const allPosts = [];
    const seenUrls = new Set(); // Deduplicación global
    let checkpointDetected = false;

    // ─── FASE 1: Scraping de hashtags ───
    console.log('\n' + '─'.repeat(60));
    console.log('FASE 1: Scraping de hashtags');
    console.log('─'.repeat(60));

    for (const hashtag of HASHTAGS) {
      const hashtagUrl = `https://www.linkedin.com/feed/hashtag/${hashtag}/`;
      const result = await scrapePage(page, hashtagUrl, `#${hashtag}`, seenUrls);

      if (result.checkpointDetected) {
        checkpointDetected = true;
        break;
      }
      allPosts.push(...result.posts);
    }

    // ─── FASE 2: Fallback a búsqueda si no hay suficientes posts ───
    if (!checkpointDetected && allPosts.length < MIN_POSTS_DESIRED) {
      console.log('\n' + '─'.repeat(60));
      console.log(`FASE 2: Fallback - Búsqueda de contenido (tenemos ${allPosts.length} posts, necesitamos ${MIN_POSTS_DESIRED})`);
      console.log('─'.repeat(60));

      const searchResult = await scrapePage(page, SEARCH_FALLBACK_URL, 'search_fallback', seenUrls);

      if (searchResult.checkpointDetected) {
        checkpointDetected = true;
      } else {
        allPosts.push(...searchResult.posts);
      }
    } else if (!checkpointDetected) {
      console.log(`\n✓ Suficientes posts de hashtags (${allPosts.length}), no se necesita fallback`);
    }

    // ─── CHECKPOINT DETECTADO: SALIR SIN ESCRIBIR ───
    if (checkpointDetected) {
      console.log('\n' + '═'.repeat(60));
      console.log('❌ ERROR: SESIÓN EXPIRADA O CHECKPOINT DETECTADO');
      console.log('═'.repeat(60));
      console.log('\nLinkedIn está pidiendo verificación adicional.');
      console.log('SOLUCIÓN: Ejecuta npm run login, completa el 2FA, llega al feed y reintenta.');
      console.log('\n⚠️  NO se ha modificado public/data.json\n');
      process.exitCode = 2;
      return;
    }

    // ─── SELECCIÓN DE TOP 3 ───
    console.log('\n' + '─'.repeat(60));
    console.log('SELECCIÓN DE TOP 3');
    console.log('─'.repeat(60));

    const postsWithMetrics = allPosts.filter(p => (p.total || 0) > 0);
    const postsWithoutMetrics = allPosts.filter(p => (p.total || 0) === 0 && (p.snippet || '').length > 0);

    let top3 = [];

    if (postsWithMetrics.length >= 3) {
      top3 = postsWithMetrics.sort((a, b) => b.total - a.total).slice(0, 3);
      console.log('\n📊 Selección por métricas (likes+comments+reposts)');
    } else if (postsWithMetrics.length > 0) {
      top3 = postsWithMetrics.sort((a, b) => b.total - a.total);
      const needed = 3 - top3.length;
      const fallback = postsWithoutMetrics.sort((a, b) => (b.snippet || '').length - (a.snippet || '').length).slice(0, needed);
      top3 = [...top3, ...fallback];
      console.log('\n📊 Selección mixta: métricas + longitud de snippet');
    } else if (postsWithoutMetrics.length > 0) {
      top3 = postsWithoutMetrics.sort((a, b) => (b.snippet || '').length - (a.snippet || '').length).slice(0, 3);
      console.log('\n📊 Selección fallback por longitud de snippet (sin métricas)');
    } else {
      console.log('\n⚠️ No se encontraron posts válidos');
    }

    console.log(`\n📊 Resumen:`);
    console.log(`   Posts totales recolectados: ${allPosts.length}`);
    console.log(`   Posts con métricas: ${postsWithMetrics.length}`);
    console.log(`   Posts sin métricas (con snippet): ${postsWithoutMetrics.length}`);
    console.log(`   Top 3 seleccionados: ${top3.length}`);

    if (top3.length > 0) {
      console.log(`\n🏆 Top 3:`);
      top3.forEach((p, i) => {
        const metrics = (p.total || 0) > 0 ? `${p.total} interacciones` : `${(p.snippet || '').length} chars`;
        const authorDisplay = p.author || 'Autor desconocido';
        console.log(`   ${i + 1}. ${authorDisplay} (${metrics}) - ${p.keyword}`);
      });
    }

    // ─── ESCRIBIR OUTPUT ───
    const output = {
      lastUpdated: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      keywords: HASHTAGS.map(h => `#${h}`),
      posts: top3,
    };

    await mkdir('public', { recursive: true });
    await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
    wroteOutput = true;

    console.log(`\n✅ Datos guardados en: ${OUTPUT_PATH}\n`);
  } finally {
    await browser.close().catch(() => {});
    if (!wroteOutput && process.exitCode === 2) {
      // Intentional: no output written
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Error fatal:', err?.message || String(err));
  process.exit(1);
});
