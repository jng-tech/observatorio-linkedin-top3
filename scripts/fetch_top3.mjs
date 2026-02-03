/**
 * fetch_top3.mjs
 *
 * Extrae posts de LinkedIn usando sesión persistida y genera:
 * - public/data.json: top 3 del día
 * - public/history.json: histórico de los top 3 de cada día
 * - public/top10.json: top 10 all-time por engagement
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
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

const STATE_PATH = 'state/linkedin.json';
const OUTPUT_PATH = 'public/data.json';
const HISTORY_PATH = 'public/history.json';
const TOP10_PATH = 'public/top10.json';
const DEBUG_DIR = 'debug';

/**
 * Hashtags seleccionados (ESG x Tech):
 * - esg: Environmental, Social, Governance - término paraguas
 * - climatetech: tecnología para combatir el cambio climático
 * - sustainability: sostenibilidad general, muy activo en LinkedIn
 */
const HASHTAGS = ['esg', 'climatetech', 'sustainability'];

/**
 * Tokens de keyword para verificar que el post CONTIENE la keyword objetivo.
 * Esto filtra "actividad" (comentarios en otros posts) que no mencionan la keyword.
 */
const KEYWORD_TOKENS = {
  esg: ['#esg', ' esg ', ' esg.', ' esg,', '(esg)', 'esg-'],
  climatetech: ['#climatetech', 'climate tech', 'climatetech', 'climate-tech'],
  sustainability: ['#sustainability', 'sustainability', 'sostenibilidad', 'sustentabilidad'],
};

// URLs de búsqueda con filtro de últimas 24 horas
// datePosted=past-24h filtra solo posts de las últimas 24 horas
// Sin sortBy para obtener los más relevantes/populares (no los más recientes)
const SEARCH_URLS = HASHTAGS.map(
  (kw) =>
    `https://www.linkedin.com/search/results/content/?keywords=%23${kw}&datePosted=%22past-24h%22`
);

// URL de búsqueda fallback combinada (también con filtro 24h)
const SEARCH_FALLBACK_URL =
  'https://www.linkedin.com/search/results/content/?keywords=esg%20climatetech%20sustainability&datePosted=%22past-24h%22';

// Configuración de scraping - AUMENTADO para mayor cobertura
const SCROLL_COUNT = 10;       // Número de scrolls por hashtag/búsqueda
const SCROLL_DELAY = 1500;     // ms entre scrolls
const CARDS_PER_SOURCE = 60;   // Máximo de cards a procesar por fuente

// Mínimo de posts únicos deseados
const MIN_POSTS_DESIRED = 3;

// Mínimo de caracteres para snippet válido
const MIN_SNIPPET_LENGTH = 40;

// Verificación de posts: visitar cada URL para confirmar que es original
const VERIFY_POSTS = true;
const VERIFY_DELAY = 3000; // ms entre verificaciones (aumentado para menor riesgo)

// ─────────────────────────────────────────────────────────────────────────────
// NUEVA CONFIGURACIÓN EXPANDIDA (v2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keywords expandidas con variantes ES/EN
 * Cada keyword tiene: id, términos de búsqueda, y tokens de verificación
 */
const KEYWORDS_CONFIG = [
  {
    id: 'esg',
    label: 'ESG',
    searchTerms: ['#esg', 'ESG'],
    tokens: ['#esg', ' esg ', ' esg.', ' esg,', '(esg)', 'esg-', 'esg reporting', 'esg criteria'],
  },
  {
    id: 'sustainability',
    label: 'Sustainability',
    searchTerms: ['#sustainability', '#sostenibilidad'],
    tokens: ['#sustainability', 'sustainability', 'sostenibilidad', 'sustentabilidad', 'sustainable'],
  },
  {
    id: 'climatetech',
    label: 'Climate Tech',
    searchTerms: ['#climatetech', 'climate tech'],
    tokens: ['#climatetech', 'climatetech', 'climate tech', 'climate-tech', 'climatech'],
  },
  {
    id: 'csrd',
    label: 'CSRD',
    searchTerms: ['CSRD', '#csrd'],
    tokens: ['csrd', '#csrd', 'corporate sustainability reporting directive'],
  },
  {
    id: 'esrs',
    label: 'ESRS',
    searchTerms: ['ESRS', '#esrs'],
    tokens: ['esrs', '#esrs', 'european sustainability reporting standards'],
  },
  {
    id: 'vsme',
    label: 'VSME',
    searchTerms: ['VSME', '#vsme'],
    tokens: ['vsme', '#vsme', 'voluntary sme standard'],
  },
  {
    id: 'non-financial-reporting',
    label: 'Non-Financial Reporting',
    searchTerms: ['non-financial reporting', 'información no financiera'],
    tokens: ['non-financial reporting', 'non financial reporting', 'información no financiera', 'informe no financiero', 'nfrd'],
  },
  {
    id: 'double-materiality',
    label: 'Double Materiality',
    searchTerms: ['double materiality', 'doble materialidad'],
    tokens: ['double materiality', 'doble materialidad', 'materiality assessment', 'análisis de materialidad'],
  },
  {
    id: 'lca',
    label: 'LCA / ACV',
    searchTerms: ['life cycle assessment', 'análisis ciclo vida', 'LCA'],
    tokens: ['lca', 'acv', 'life cycle assessment', 'análisis ciclo vida', 'análisis de ciclo de vida', 'life-cycle assessment'],
  },
  {
    id: 'scope-emissions',
    label: 'Scope 1 2 3',
    searchTerms: ['scope 1 2 3', 'scope emissions', 'alcance 1 2 3'],
    tokens: ['scope 1', 'scope 2', 'scope 3', 'alcance 1', 'alcance 2', 'alcance 3', 'scope emissions', 'emisiones alcance'],
  },
  {
    id: 'eu-taxonomy',
    label: 'EU Taxonomy',
    searchTerms: ['EU taxonomy', 'taxonomía europea', '#eutaxonomy'],
    tokens: ['eu taxonomy', 'taxonomía europea', 'taxonomia europea', 'european taxonomy', '#eutaxonomy', 'taxonomy regulation'],
  },
  {
    id: 'ghg-protocol',
    label: 'GHG Protocol',
    searchTerms: ['GHG protocol', 'protocolo GEI', '#ghgprotocol'],
    tokens: ['ghg protocol', 'protocolo gei', 'greenhouse gas protocol', 'gases efecto invernadero', '#ghgprotocol'],
  },
  {
    id: 'esg-data',
    label: 'ESG Data',
    searchTerms: ['ESG data', 'datos ESG', '#esgdata'],
    tokens: ['esg data', 'datos esg', 'esg metrics', 'métricas esg', 'esg reporting data', '#esgdata'],
  },
];

/**
 * Genera URLs de búsqueda para todas las keywords
 * Filtro: últimas 24 horas
 */
function generateSearchUrls() {
  const urls = [];
  for (const kw of KEYWORDS_CONFIG) {
    for (const term of kw.searchTerms) {
      const encoded = encodeURIComponent(term);
      urls.push({
        url: `https://www.linkedin.com/search/results/content/?keywords=${encoded}&datePosted=%22past-24h%22`,
        keywordId: kw.id,
        keywordLabel: kw.label,
        searchTerm: term,
      });
    }
  }
  return urls;
}

const ALL_SEARCH_URLS_FULL = generateSearchUrls();

// QUICK_TEST=1 limita a 3 keywords para pruebas rápidas (~8 minutos)
const QUICK_TEST = process.env.QUICK_TEST === '1';
const QUICK_TEST_KEYWORDS = ['esg', 'sustainability', 'climatetech'];

const ALL_SEARCH_URLS = QUICK_TEST
  ? ALL_SEARCH_URLS_FULL.filter(u => QUICK_TEST_KEYWORDS.includes(u.keywordId))
  : ALL_SEARCH_URLS_FULL;

/**
 * Configuración de delays "humanos" para menor riesgo de detección
 */
const HUMAN_DELAYS = {
  scrollDelayMin: 2000,        // ms mínimo entre scrolls
  scrollDelayMax: 3500,        // ms máximo entre scrolls
  searchDelayMin: 8000,        // ms mínimo entre búsquedas
  searchDelayMax: 15000,       // ms máximo entre búsquedas
  longPauseEvery: 5,           // cada N búsquedas, pausa larga
  longPauseMin: 30000,         // ms mínimo pausa larga
  longPauseMax: 60000,         // ms máximo pausa larga
  scrollAmountMin: 800,        // px mínimo de scroll
  scrollAmountMax: 1400,       // px máximo de scroll
};

/**
 * Genera un delay aleatorio entre min y max
 */
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Espera un tiempo aleatorio (simula comportamiento humano)
 */
async function humanWait(min, max) {
  const delay = randomDelay(min, max);
  await new Promise(resolve => setTimeout(resolve, delay));
  return delay;
}

/**
 * Detecta el idioma de un texto basándose en palabras comunes
 * @param {string} text - Texto a analizar
 * @returns {'ES' | 'EN'} - Idioma detectado
 */
function detectLanguage(text) {
  if (!text) return 'EN';

  const textLower = text.toLowerCase();

  // Palabras comunes en español (más específicas para evitar falsos positivos)
  const spanishWords = [
    ' el ', ' la ', ' los ', ' las ', ' de ', ' del ', ' que ', ' en ', ' es ', ' un ', ' una ',
    ' para ', ' con ', ' por ', ' su ', ' sus ', ' al ', ' se ', ' como ', ' más ', ' pero ',
    ' este ', ' esta ', ' estos ', ' estas ', ' sobre ', ' entre ', ' también ', ' sido ',
    ' hace ', ' hacia ', ' desde ', ' durante ', ' mediante ', ' según ', ' aunque ',
    ' puede ', ' pueden ', ' debe ', ' deben ', ' tiene ', ' tienen ', ' está ', ' están ',
    ' será ', ' serán ', ' siendo ', ' hemos ', ' nuestra ', ' nuestro ', ' empresa ', ' empresas ',
  ];

  // Palabras comunes en inglés
  const englishWords = [
    ' the ', ' is ', ' are ', ' was ', ' were ', ' be ', ' been ', ' being ',
    ' have ', ' has ', ' had ', ' do ', ' does ', ' did ', ' will ', ' would ',
    ' could ', ' should ', ' may ', ' might ', ' must ', ' shall ',
    ' for ', ' and ', ' with ', ' that ', ' this ', ' from ', ' they ', ' we ',
    ' our ', ' your ', ' their ', ' which ', ' when ', ' where ', ' how ', ' why ',
    ' about ', ' into ', ' through ', ' during ', ' before ', ' after ',
    ' company ', ' business ', ' report ', ' reporting ',
  ];

  let spanishScore = 0;
  let englishScore = 0;

  for (const word of spanishWords) {
    if (textLower.includes(word)) spanishScore++;
  }

  for (const word of englishWords) {
    if (textLower.includes(word)) englishScore++;
  }

  // Si hay más palabras en español, es español
  return spanishScore > englishScore ? 'ES' : 'EN';
}

/**
 * Verifica si el texto contiene tokens de una keyword específica
 */
function matchesKeyword(text, keywordId) {
  if (!text || !keywordId) return false;

  const config = KEYWORDS_CONFIG.find(k => k.id === keywordId);
  if (!config) return false;

  const textLower = text.toLowerCase();
  return config.tokens.some(token => textLower.includes(token.toLowerCase()));
}

// Configuración actualizada de scraping (sobrescribe valores anteriores)
const SCROLL_COUNT_V2 = 8;       // Scrolls por búsqueda (ligeramente reducido)
const CARDS_PER_SOURCE_V2 = 40;  // Cards por fuente (reducido para mejor filtrado)

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN COMPARTIDA (debe coincidir con login_once.mjs)
// ─────────────────────────────────────────────────────────────────────────────

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const VIEWPORT = { width: 1280, height: 900 };

// CI_HEADFUL=1 fuerza modo headed (con display virtual xvfb en CI)
// Esto reduce la probabilidad de checkpoint de LinkedIn
const USE_HEADFUL = process.env.CI_HEADFUL === '1';

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

/**
 * Calcula score de engagement (likes + comments)
 */
function calcScore(post) {
  return (post.likes || 0) + (post.comments || 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICACIÓN DE POSTS ORIGINALES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Visita un post individual y extrae los datos REALES del autor original.
 * Esta es la forma más fiable de asegurar que capturamos el post original.
 *
 * @param {Page} page - Página de Playwright
 * @param {string} postUrl - URL del post a verificar
 * @returns {Promise<{isOriginal: boolean, realAuthor: string, realLikes: number, realComments: number, realReposts: number, realSnippet: string}>}
 */
async function verifyAndExtractPost(page, postUrl) {
  const result = {
    isOriginal: false,
    realAuthor: '',
    realLikes: 0,
    realComments: 0,
    realReposts: 0,
    realSnippet: '',
  };

  try {
    console.log(`      🔍 Verificando: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Detectar si es un repost mirando la estructura de la página
    const pageContent = await page.content();
    const pageText = await page.innerText('body').catch(() => '');

    // Patrones de repost en la página del post (múltiples idiomas)
    const repostIndicators = [
      /reposted\s+this/i,
      /reposted$/im,
      /\breposted\b/i,
      /compartió\s+esto/i,
      /compartió$/im,
      /ha\s+compartido/i,
      /volvió\s+a\s+publicar/i,
      /shared\s+this/i,
      /a\s+partagé/i,
      /hat\s+geteilt/i,
      /ha\s+condiviso/i,
    ];

    // Buscar en los primeros 2000 caracteres del texto
    const textToCheck = pageText.substring(0, 2000);
    for (const pattern of repostIndicators) {
      if (pattern.test(textToCheck)) {
        console.log(`      ❌ Es un REPOST (patrón: ${pattern})`);
        return result;
      }
    }

    // Buscar el header de repost específico de LinkedIn
    const repostHeaderSelectors = [
      '.feed-shared-header',
      '.update-components-header',
      '.feed-shared-actor__sub-description',
      '.update-components-actor__sub-description',
    ];

    for (const selector of repostHeaderSelectors) {
      const repostHeader = await page.$(selector);
      if (repostHeader) {
        const headerText = await repostHeader.innerText().catch(() => '');
        for (const pattern of repostIndicators) {
          if (pattern.test(headerText)) {
            console.log(`      ❌ Es un REPOST (header: "${headerText.substring(0, 50)}")`);
            return result;
          }
        }
      }
    }

    // Verificar si hay un "post dentro de post" (estructura de repost)
    // LinkedIn muestra el post original anidado dentro del repost
    const nestedPost = await page.$$('.feed-shared-update-v2__update-content-wrapper .feed-shared-update-v2');
    if (nestedPost && nestedPost.length > 0) {
      console.log(`      ❌ Es un REPOST (post anidado detectado)`);
      return result;
    }

    // Verificar si hay múltiples autores (indicador de repost)
    const authorElements = await page.$$('.update-components-actor__name, .feed-shared-actor__name');
    if (authorElements && authorElements.length > 1) {
      console.log(`      ❌ Es un REPOST (múltiples autores detectados)`);
      return result;
    }

    // Extraer el autor REAL del post
    const authorSelectors = [
      '.update-components-actor__name span[aria-hidden="true"]',
      '.feed-shared-actor__name span[aria-hidden="true"]',
      'span.update-components-actor__name',
      'span.feed-shared-actor__name',
      '.update-components-actor__title span:first-child',
    ];

    for (const selector of authorSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const text = await el.innerText().catch(() => '');
          if (text && text.trim().length > 1) {
            result.realAuthor = text.trim().split('\n')[0].trim();
            break;
          }
        }
      } catch {}
    }

    // Extraer el snippet REAL del post
    const snippetSelectors = [
      '.feed-shared-update-v2__description',
      '.update-components-text',
      '.feed-shared-text',
      'div[data-test-id="main-feed-activity-card__commentary"]',
    ];

    for (const selector of snippetSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          const text = await el.innerText().catch(() => '');
          if (text && text.trim().length > 20) {
            result.realSnippet = cleanSnippet(text.trim());
            break;
          }
        }
      } catch {}
    }

    // Extraer métricas REALES
    try {
      // Likes/Reactions
      const reactionsEl = await page.$('.social-details-social-counts__reactions-count');
      if (reactionsEl) {
        const text = await reactionsEl.innerText().catch(() => '');
        result.realLikes = parseNumber(text);
      }

      // Buscar en el área de social counts
      const socialCounts = await page.$('.social-details-social-counts');
      if (socialCounts) {
        const countsText = await socialCounts.innerText().catch(() => '');

        // Comments
        const commentsMatch = countsText.match(/(\d+(?:[.,]\d+)?[kKmM]?)\s*(?:comment|comentario)/i);
        if (commentsMatch) {
          result.realComments = parseNumber(commentsMatch[1]);
        }

        // Reposts
        const repostsMatch = countsText.match(/(\d+(?:[.,]\d+)?[kKmM]?)\s*(?:repost|compartido)/i);
        if (repostsMatch) {
          result.realReposts = parseNumber(repostsMatch[1]);
        }
      }
    } catch {}

    // Si llegamos aquí y tenemos autor, es un post original
    if (result.realAuthor) {
      result.isOriginal = true;
      console.log(`      ✅ Post ORIGINAL de: ${result.realAuthor} (${result.realLikes} likes)`);
    } else {
      console.log(`      ⚠️ No se pudo extraer autor`);
    }

  } catch (err) {
    console.log(`      ⚠️ Error verificando post: ${err.message}`);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECCIÓN DE ACTIVIDAD (comentarios, likes, reposts de otros)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecta si una card es de "actividad" (no un post original).
 * Busca patrones como "comentó", "commented on", "liked", etc.
 * NOTA: NO incluimos "reposted/shared/compartió" aquí porque se manejan aparte
 * @param {string} cardText - Texto completo de la card
 * @returns {boolean} true si es actividad (no post original)
 */
function isActivityCard(cardText) {
  if (!cardText) return false;

  // Patrones de actividad en español e inglés (case-insensitive)
  // EXCLUIMOS repost/shared/compartió - se filtran con isRepostByText()
  const activityPatterns = [
    // Español
    /\bcomentó\b/i,
    /\bcomentó en\b/i,
    /\ble gustó\b/i,
    /\breaccionó\b/i,
    /\bcelebró\b/i,
    /\brecomendó\b/i,
    /\brespondi[oó]\b/i,
    // Inglés
    /\bcommented on\b/i,
    /\breplied to\b/i,
    /\bliked\b/i,
    /\blikes this\b/i,
    /\breacted to\b/i,
    /\bcelebrated\b/i,
    /\brecommended\b/i,
    /\bfollows\b/i,
    /\bfound this interesting\b/i,
    /\bsupports this\b/i,
    /\bloves this\b/i,
    /\bfunny\b/i,
  ];

  for (const pattern of activityPatterns) {
    if (pattern.test(cardText)) {
      return true;
    }
  }

  return false;
}

/**
 * Detecta si el HEADER de la card indica que es un repost/share.
 * Busca específicamente en las primeras líneas del texto.
 * @param {string} cardText - Texto completo de la card
 * @returns {boolean} true si es un repost
 */
function isRepostByText(cardText) {
  if (!cardText) return false;

  // Solo mirar las primeras 500 caracteres (el header de la card)
  const headerText = cardText.substring(0, 500).toLowerCase();

  // Patrones que indican repost en el header
  const repostPatterns = [
    /reposted\s+this/i,
    /reposted$/im,           // "X reposted" al final de una línea
    /\breposted\b/i,
    /\bshared\s+this\b/i,
    /\bshared\s+a\s+post\b/i,
    /\bcompartió\s+esto\b/i,
    /\bcompartió\s+una\s+publicación\b/i,
    /\bha\s+compartido\b/i,
    /\bvolvió\s+a\s+publicar\b/i,
  ];

  for (const pattern of repostPatterns) {
    if (pattern.test(headerText)) {
      return true;
    }
  }

  return false;
}

/**
 * Detecta si una card es un repost/compartido (no el post original).
 * Usa múltiples métodos: texto de header, selectores CSS, clases.
 * @param {ElementHandle} card - Elemento de la card
 * @param {string} cardText - Texto completo de la card (ya extraído)
 * @returns {Promise<boolean>} true si es un repost
 */
async function isRepostCard(card, cardText) {
  try {
    // Método 0: Detección por texto del header (MÁS FIABLE)
    if (isRepostByText(cardText)) {
      return true;
    }

    // Método 1: Buscar el header de "X reposted" o "X compartió"
    const headerSelectors = [
      '.update-components-header',
      '.feed-shared-header',
      '.update-components-actor__description',
      '.update-components-header__text-view',
    ];

    for (const selector of headerSelectors) {
      const header = await card.$(selector);
      if (header) {
        const headerText = await header.innerText().catch(() => '');
        const repostPatterns = [
          /reposted/i,
          /shared/i,
          /compartió/i,
          /ha compartido/i,
          /volvió a publicar/i,
        ];
        for (const pattern of repostPatterns) {
          if (pattern.test(headerText)) {
            return true;
          }
        }
      }
    }

    // Método 2: Detectar si hay un post embebido (mini-update dentro de la card)
    const embeddedSelectors = [
      '.update-components-mini-update-v2',
      '.feed-shared-mini-update-v2',
      '.update-components-update-v2__embedded-content',
      '.feed-shared-reshared-update-v2',
    ];

    for (const selector of embeddedSelectors) {
      const embedded = await card.$(selector);
      if (embedded) {
        return true;
      }
    }

    // Método 3: Buscar clase específica de repost en la card
    const cardClass = await card.getAttribute('class').catch(() => '');
    if (cardClass && (cardClass.includes('repost') || cardClass.includes('reshare'))) {
      return true;
    }

    // Método 4: Buscar data-attributes que indiquen repost
    const dataRepost = await card.getAttribute('data-is-repost').catch(() => null);
    if (dataRepost === 'true') {
      return true;
    }

    // Método 5: Detectar múltiples autores en la card (indicador de repost)
    // Si hay más de un nombre de actor, probablemente es un repost
    const actorElements = await card.$$('.update-components-actor__name, .feed-shared-actor__name');
    if (actorElements.length > 1) {
      return true;
    }

    // Método 6: Buscar estructuras de "shared from" o "via"
    // En el contenido del card, buscar patrones de atribución a otro autor
    const attributionPatterns = [
      /\bvia\s+@/i,
      /\bshared\s+from\b/i,
      /\boriginally\s+posted\s+by\b/i,
      /\bde\s+@\w+/i,  // "de @usuario" en español
    ];

    for (const pattern of attributionPatterns) {
      if (pattern.test(cardText)) {
        return true;
      }
    }

    // Método 7: Detectar múltiples URLs de posts en la misma card
    // Si hay más de una URL de post, probablemente es un repost
    const allLinks = await card.$$('a[href]');
    const postUrls = [];
    const profileUrls = [];

    for (const link of allLinks) {
      const href = await link.getAttribute('href').catch(() => null);
      if (!href) continue;

      // URLs de posts
      if (
        href.includes('/feed/update/') ||
        href.includes('/posts/') ||
        href.includes('urn:li:activity')
      ) {
        const normalized = href.split('?')[0];
        if (!postUrls.includes(normalized)) {
          postUrls.push(normalized);
        }
      }

      // URLs de perfiles (personas o empresas)
      if (href.includes('/in/') || href.includes('/company/')) {
        const normalized = href.split('?')[0];
        if (!profileUrls.includes(normalized)) {
          profileUrls.push(normalized);
        }
      }
    }

    // Si hay más de una URL de post diferente, es un repost
    if (postUrls.length > 1) {
      return true;
    }

  } catch {}

  return false;
}

/**
 * Verifica si el texto contiene la keyword objetivo
 * @param {string} text - Texto a verificar (snippet + cardText)
 * @param {string} hashtag - Hashtag sin # (ej: "esg")
 * @returns {boolean} true si contiene la keyword
 */
function containsKeyword(text, hashtag) {
  if (!text || !hashtag) return false;

  const tokens = KEYWORD_TOKENS[hashtag.toLowerCase()] || [`#${hashtag}`, hashtag];
  const textLower = text.toLowerCase();

  for (const token of tokens) {
    if (textLower.includes(token.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Detecta si un post probablemente es un repost basándose en las URLs de perfil.
 * Heurística: si hay un link a una empresa/organización prominente que no es
 * donde trabaja el autor (basándose en que no aparece en su bio), probablemente es un repost.
 *
 * @param {string} author - Nombre del autor detectado
 * @param {string[]} profileUrls - URLs de perfiles encontradas en la card
 * @param {string} cardText - Texto completo de la card para contexto
 * @returns {boolean} true si probablemente es un repost
 */
function isProbableRepost(author, profileUrls, cardText = '') {
  if (!author || !profileUrls || profileUrls.length === 0) return false;

  // Normalizar nombre del autor para comparación
  const authorNormalized = author.toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/[^a-z0-9\s]/g, '');

  const authorParts = authorNormalized.split(/\s+/).filter(p => p.length > 2);

  // Contar empresas sin relación con el autor
  let unrelatedCompanies = [];

  for (const url of profileUrls) {
    if (url.includes('/company/') && !url.includes('/posts')) {
      // Extraer slug de la empresa
      const match = url.match(/\/company\/([^/]+)/);
      if (match) {
        const companySlug = match[1].toLowerCase().replace(/-/g, '');

        // Verificar si el slug tiene alguna relación con el nombre del autor
        const hasAuthorRelation = authorParts.some(part =>
          part.length > 2 && companySlug.includes(part)
        );

        if (!hasAuthorRelation) {
          unrelatedCompanies.push(match[1]);
        }
      }
    }
  }

  // Si hay empresas sin relación con el autor, verificar si aparecen prominentemente
  // Una empresa prominente que no es del autor sugiere que es contenido de esa empresa (repost)
  if (unrelatedCompanies.length > 0) {
    // Verificar si la primera empresa sin relación aparece temprano en las URLs
    const firstUnrelatedCompany = unrelatedCompanies[0];
    const companyUrl = profileUrls.find(u => u.includes(`/company/${firstUnrelatedCompany}`));
    const companyIndex = profileUrls.indexOf(companyUrl);

    // Si la empresa sin relación aparece en las primeras 4 URLs, probablemente es un repost
    // porque normalmente el autor aparece primero
    if (companyIndex >= 0 && companyIndex < 4) {
      return true;
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTÓRICO Y TOP 10
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Carga el histórico existente o devuelve array vacío
 */
async function loadHistory() {
  try {
    if (!existsSync(HISTORY_PATH)) {
      return [];
    }
    const content = await readFile(HISTORY_PATH, 'utf8');
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Añade posts al histórico, deduplica por URL normalizada
 * @param {Array} history - Histórico existente
 * @param {Array} newPosts - Posts nuevos del día
 * @param {string} date - Fecha YYYY-MM-DD
 * @returns {Array} Histórico actualizado
 */
function mergeHistory(history, newPosts, date) {
  // Crear set de URLs ya en histórico
  const seenUrls = new Set(history.map(p => normalizeUrl(p.url)));

  // Añadir posts nuevos con fecha
  for (const post of newPosts) {
    const normalized = normalizeUrl(post.url);
    if (!seenUrls.has(normalized)) {
      seenUrls.add(normalized);
      history.push({
        ...post,
        date, // Añadir fecha de captura
      });
    }
  }

  return history;
}

/**
 * Genera top 10 all-time por score (likes + comments)
 * @param {Array} history - Histórico completo
 * @returns {Array} Top 10 posts como array puro
 */
function generateTop10(history) {
  return history
    .map(post => ({
      url: post.url,
      author: post.author || '',
      snippet: post.snippet || '',
      keyword: post.keyword || '',
      keywordId: post.keywordId || '',
      language: post.language || 'EN',
      date: post.date || '',
      likes: post.likes || 0,
      comments: post.comments || 0,
      reposts: post.reposts || 0,
      total: (post.likes || 0) + (post.comments || 0) + (post.reposts || 0),
    }))
    .sort((a, b) => calcScore(b) - calcScore(a))
    .slice(0, 10);
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
 * @returns {{ posts: Array, checkpointDetected: boolean, stats: Object }}
 */
async function scrapePage(page, url, source, seenUrls) {
  console.log(`\n📍 Navegando a: ${url}`);

  // Stats de filtrado
  const stats = {
    totalCards: 0,
    discardedActivity: 0,
    discardedRepost: 0,
    discardedNoKeyword: 0,
    discardedShortSnippet: 0,
    discardedNoUrl: 0,
    accepted: 0,
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    console.log(`   ⚠️ Error cargando página: ${err?.message || String(err)}`);
    return { posts: [], checkpointDetected: false, stats };
  }

  await page.waitForTimeout(3000);

  // URL final (por si hubo redirect)
  console.log(`   📍 URL final: ${safeUrl(page)}`);

  // Detect checkpoint/login
  if (await isOnLoginOrCheckpoint(page)) {
    console.log('\n   ❌ CHECKPOINT/LOGIN DETECTADO');
    console.log('   La sesión ha expirado o LinkedIn requiere verificación.');
    await saveDebugFiles(page, source, 'checkpoint_detected');
    return { posts: [], checkpointDetected: true, stats };
  }

  // Scroll con comportamiento humano (delays y cantidades variables)
  console.log(`   Haciendo scroll (${SCROLL_COUNT_V2}x con delays humanos)...`);
  for (let i = 0; i < SCROLL_COUNT_V2; i++) {
    try {
      if (page.isClosed()) break;
      const scrollAmount = randomDelay(HUMAN_DELAYS.scrollAmountMin, HUMAN_DELAYS.scrollAmountMax);
      await page.mouse.wheel(0, scrollAmount);
      const waited = await humanWait(HUMAN_DELAYS.scrollDelayMin, HUMAN_DELAYS.scrollDelayMax);
      if (i === Math.floor(SCROLL_COUNT_V2 / 2)) {
        console.log(`   ... scroll ${i + 1}/${SCROLL_COUNT_V2} (delay: ${waited}ms)`);
      }
    } catch {}
  }
  await page.waitForTimeout(1500);

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
    return { posts: [], checkpointDetected: false, stats };
  }

  const posts = [];
  const cardsToProcess = cards.slice(0, CARDS_PER_SOURCE_V2);
  stats.totalCards = cardsToProcess.length;

  // Extraer hashtag de source (ej: "#esg" -> "esg")
  const hashtag = source.startsWith('#') ? source.substring(1) : source;

  for (const card of cardsToProcess) {
    try {
      const result = await extractPostData(card, source, hashtag);

      if (result === null) {
        // Ya se contó en extractPostData
        continue;
      }

      if (result.discardReason) {
        // Contar razón de descarte
        if (result.discardReason === 'activity') stats.discardedActivity++;
        else if (result.discardReason === 'repost') stats.discardedRepost++;
        else if (result.discardReason === 'no_keyword') stats.discardedNoKeyword++;
        else if (result.discardReason === 'short_snippet') stats.discardedShortSnippet++;
        else if (result.discardReason === 'no_url') stats.discardedNoUrl++;
        continue;
      }

      const post = result.post;
      if (post && post.url) {
        const normalized = normalizeUrl(post.url);
        // Solo añadir si no está ya visto
        if (!seenUrls.has(normalized)) {
          seenUrls.add(normalized);
          posts.push(post);
          stats.accepted++;
        }
      }
    } catch {}
  }

  console.log(`   ✓ Extraídos ${posts.length} posts nuevos (únicos)`);

  // Imprimir resumen de filtrado
  console.log(`\n   ┌── RESUMEN FILTRADO ─────────────────────────────`);
  console.log(`   │ Cards procesadas: ${stats.totalCards}`);
  console.log(`   │ ❌ Descartadas por actividad: ${stats.discardedActivity}`);
  console.log(`   │ ❌ Descartadas por repost: ${stats.discardedRepost}`);
  console.log(`   │ ❌ Descartadas sin keyword: ${stats.discardedNoKeyword}`);
  console.log(`   │ ❌ Descartadas snippet corto: ${stats.discardedShortSnippet}`);
  console.log(`   │ ❌ Descartadas sin URL: ${stats.discardedNoUrl}`);
  console.log(`   │ ✅ Aceptadas: ${stats.accepted}`);
  console.log(`   └──────────────────────────────────────────────────`);

  if (posts.length === 0 && cards.length > 0) {
    await saveDebugFiles(page, source, 'cards_found_but_no_new_posts_extracted');
  }

  return { posts, checkpointDetected: false, stats };
}

/**
 * Extrae datos de un post de una card
 * @param {ElementHandle} card - Elemento de la card
 * @param {string} source - Fuente (ej: "#esg")
 * @param {string} hashtag - Hashtag sin # (ej: "esg")
 * @returns {Object|null} { post, discardReason } o null
 */
async function extractPostData(card, source, hashtag) {
  // Obtener texto completo de la card para filtros
  const cardText = await card.innerText().catch(() => '');

  // DEBUG: Imprimir primeras 200 chars del cardText para ver formato (deshabilitado)
  // const debugHeader = cardText.substring(0, 200).replace(/\n/g, '\\n');
  // console.log(`      [DEBUG] Card: ${debugHeader}...`);

  // 1) Filtrar actividad (comentarios, likes, reposts de otros)
  if (isActivityCard(cardText)) {
    return { discardReason: 'activity' };
  }

  // 2) Detectar si es un repost - si lo es, DESCARTAR (no intentar extraer embebido)
  const isRepost = await isRepostCard(card, cardText);

  // NUEVO ENFOQUE: Descartar reposts directamente en lugar de intentar extraer el embebido
  // Los selectores de embebido no funcionan bien y terminamos capturando la info del que compartió
  if (isRepost) {
    return { discardReason: 'repost' };
  }

  // A partir de aquí, la card NO es un repost, es un post original
  // Extraer datos directamente de la card

  // URL - MÚLTIPLES ESTRATEGIAS
  let url = null;

  // Estrategia 1: Extraer del data-urn de la card (más fiable)
  try {
    const dataUrn = await card.getAttribute('data-urn');
    if (dataUrn && dataUrn.includes('urn:li:activity:')) {
      url = `https://www.linkedin.com/feed/update/${dataUrn}/`;
    }
  } catch {}

  // Estrategia 2: Buscar en links de la card
  if (!url) {
    const allLinks = await card.$$('a[href]');
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
  }

  // Estrategia 3: Buscar data-urn en elementos hijos
  if (!url) {
    try {
      const urnElement = await card.$('[data-urn*="urn:li:activity:"]');
      if (urnElement) {
        const dataUrn = await urnElement.getAttribute('data-urn');
        if (dataUrn) {
          url = `https://www.linkedin.com/feed/update/${dataUrn}/`;
        }
      }
    } catch {}
  }

  // Estrategia 4: Buscar en el texto de la card por patrones de URL
  if (!url) {
    const urnMatch = cardText.match(/urn:li:activity:(\d+)/);
    if (urnMatch) {
      url = `https://www.linkedin.com/feed/update/urn:li:activity:${urnMatch[1]}/`;
    }
  }

  if (!url) {
    return { discardReason: 'no_url' };
  }

  // Obtener todos los links para extracción posterior de perfiles
  const allLinks = await card.$$('a[href]');

  // Autor - buscar en la card
  const authorSelectors = [
    'span.update-components-actor__name',
    'span.feed-shared-actor__name',
    '.update-components-actor__title span[aria-hidden="true"]',
    '.feed-shared-actor__title span[aria-hidden="true"]',
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

  // Extraer URLs de perfiles para verificación de repost
  const profileUrls = [];
  for (const link of allLinks) {
    const href = await link.getAttribute('href').catch(() => null);
    if (!href) continue;
    if (href.includes('/in/') || href.includes('/company/')) {
      const normalized = href.split('?')[0];
      if (!profileUrls.includes(normalized)) {
        profileUrls.push(normalized);
      }
    }
  }

  // Verificación adicional: detectar probable repost por análisis de URLs de perfil
  if (author && isProbableRepost(author, profileUrls, cardText)) {
    return { discardReason: 'repost' };
  }

  // Snippet - PRIORIZAR selectores de commentary/descripción del post
  const textSelectors = [
    'div.update-components-update-v2__commentary',  // Comentario del autor
    'div.feed-shared-update-v2__description',       // Descripción del post
    'div.update-components-text',                   // Texto genérico
    'div.feed-shared-text',
    'span.break-words',
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

  // Fallback al texto de la card
  if (!snippet) {
    snippet = cleanSnippet(cardText);
  }

  // 2) Filtrar por snippet corto
  if (snippet.length < MIN_SNIPPET_LENGTH) {
    return { discardReason: 'short_snippet' };
  }

  // 3) Filtrar si no contiene keyword (solo para hashtags, no para search_fallback)
  if (hashtag && hashtag !== 'search_fallback') {
    const textToCheck = (snippet + ' ' + cardText).toLowerCase();
    if (!containsKeyword(textToCheck, hashtag)) {
      return { discardReason: 'no_keyword' };
    }
  }

  // ─── EXTRACCIÓN DE MÉTRICAS ───
  // Simplificado: solo extraemos likes de forma confiable
  // Comments y reposts se dejan en 0 por ahora (los regex capturan basura)

  let likes = 0;
  let comments = 0;
  let reposts = 0;

  // Buscar el contador de reacciones (likes) - es el más confiable
  try {
    // Método 1: span específico de reactions count
    const reactionsSpan = await card.$('span.social-details-social-counts__reactions-count');
    if (reactionsSpan) {
      const text = await reactionsSpan.innerText().catch(() => '');
      const num = parseNumber(text);
      if (num > 0 && num < 1000000) {
        likes = num;
      }
    }
  } catch {}

  // Método 2: Si no encontramos el span, buscar en el botón de reacciones
  if (likes === 0) {
    try {
      const socialCounts = await card.$('.social-details-social-counts');
      if (socialCounts) {
        // Buscar el primer número que aparece (suele ser las reacciones)
        const text = await socialCounts.innerText().catch(() => '');
        const firstNumMatch = text.match(/^[\s]*(\d+)/);
        if (firstNumMatch) {
          const num = parseInt(firstNumMatch[1], 10);
          if (num > 0 && num < 1000000) {
            likes = num;
          }
        }
      }
    } catch {}
  }

  // Para comments: buscar específicamente "X comment" o "X comentario"
  try {
    const socialCounts = await card.$('.social-details-social-counts');
    if (socialCounts) {
      const text = await socialCounts.innerText().catch(() => '');
      // Patrón más estricto: número seguido directamente de "comment"
      const commentsMatch = text.match(/(\d+)\s*comment/i);
      if (commentsMatch) {
        const num = parseInt(commentsMatch[1], 10);
        if (num > 0 && num < 10000) {
          comments = num;
        }
      }
    }
  } catch {}

  // Reposts: deshabilitado por ahora - los regex capturan números incorrectos
  // TODO: investigar mejor selector para reposts
  reposts = 0;

  const total = likes + comments + reposts;

  // Determinar keyword basado en fuente
  let keyword = source;
  let keywordId = '';
  if (source.startsWith('#')) {
    keyword = source;
    // Intentar encontrar el keywordId basado en el hashtag
    const hashtagLower = source.substring(1).toLowerCase();
    const matchedConfig = KEYWORDS_CONFIG.find(k => k.id === hashtagLower || k.searchTerms.some(t => t.toLowerCase().includes(hashtagLower)));
    if (matchedConfig) {
      keywordId = matchedConfig.id;
    }
  } else if (source === 'search_fallback') {
    keyword = '#esg+climatetech+sustainability';
    keywordId = 'global';
  }

  // Detectar idioma del post basándose en el snippet
  const language = detectLanguage(snippet);

  return {
    post: {
      url,
      author: author || '',
      title: author || 'Publicación LinkedIn',
      snippet,
      likes,
      comments,
      reposts,
      total,
      keyword,
      keywordId,
      language,
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     FETCH TOP 3 LINKEDIN (ESG x Tech) - v2 Expandido         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (!existsSync(STATE_PATH)) {
    console.error(`\n❌ No existe ${STATE_PATH}`);
    console.error('   Ejecuta primero: npm run login\n');
    process.exit(1);
  }

  console.log(`\n📂 Usando sesión: ${STATE_PATH}`);
  console.log(`🏷️  Keywords: ${KEYWORDS_CONFIG.length} (${KEYWORDS_CONFIG.map(k => k.label).join(', ')})`);
  console.log(`🔍 Búsquedas totales: ${ALL_SEARCH_URLS.length}`);
  console.log(`📜 Scroll: ${SCROLL_COUNT_V2}x por fuente, hasta ${CARDS_PER_SOURCE_V2} cards`);
  console.log(`⏱️  Delays humanos: ${HUMAN_DELAYS.searchDelayMin/1000}-${HUMAN_DELAYS.searchDelayMax/1000}s entre búsquedas`);
  console.log(`☕ Pausa larga cada ${HUMAN_DELAYS.longPauseEvery} búsquedas: ${HUMAN_DELAYS.longPauseMin/1000}-${HUMAN_DELAYS.longPauseMax/1000}s`);
  console.log(`🖥️  Modo: ${USE_HEADFUL ? 'HEADED (xvfb)' : 'headless'}`);
  console.log(`📏 Snippet mínimo: ${MIN_SNIPPET_LENGTH} caracteres`);
  console.log(`\n⏳ Tiempo estimado: ~${Math.round(ALL_SEARCH_URLS.length * 2)} minutos`);

  const browser = await chromium.launch({
    headless: !USE_HEADFUL,
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

    // Stats globales
    const globalStats = {
      totalCards: 0,
      discardedActivity: 0,
      discardedRepost: 0,
      discardedNoKeyword: 0,
      discardedShortSnippet: 0,
      discardedNoUrl: 0,
      accepted: 0,
    };

    // ─── FASE 1: Búsqueda expandida con todas las keywords (v2) ───
    console.log('\n' + '─'.repeat(60));
    console.log('FASE 1: Búsqueda expandida de contenido (últimas 24 horas)');
    console.log(`Total de búsquedas: ${ALL_SEARCH_URLS.length} (${KEYWORDS_CONFIG.length} keywords)`);
    console.log('─'.repeat(60));

    const startTime = Date.now();

    for (let i = 0; i < ALL_SEARCH_URLS.length; i++) {
      const searchConfig = ALL_SEARCH_URLS[i];
      console.log(`\n🔍 [${i + 1}/${ALL_SEARCH_URLS.length}] Buscando "${searchConfig.searchTerm}" (${searchConfig.keywordLabel})...`);

      const result = await scrapePage(page, searchConfig.url, searchConfig.searchTerm, seenUrls);

      if (result.checkpointDetected) {
        checkpointDetected = true;
        break;
      }

      // Añadir keywordId a los posts encontrados
      for (const post of result.posts) {
        if (!post.keywordId) {
          post.keywordId = searchConfig.keywordId;
        }
      }

      allPosts.push(...result.posts);

      // Acumular stats
      globalStats.totalCards += result.stats.totalCards;
      globalStats.discardedActivity += result.stats.discardedActivity;
      globalStats.discardedRepost += result.stats.discardedRepost;
      globalStats.discardedNoKeyword += result.stats.discardedNoKeyword;
      globalStats.discardedShortSnippet += result.stats.discardedShortSnippet;
      globalStats.discardedNoUrl += result.stats.discardedNoUrl;
      globalStats.accepted += result.stats.accepted;

      // Delay entre búsquedas (comportamiento humano)
      if (i < ALL_SEARCH_URLS.length - 1) {
        // Pausa larga cada N búsquedas
        if ((i + 1) % HUMAN_DELAYS.longPauseEvery === 0) {
          const longPause = randomDelay(HUMAN_DELAYS.longPauseMin, HUMAN_DELAYS.longPauseMax);
          console.log(`\n   ☕ Pausa larga: ${Math.round(longPause / 1000)}s (búsqueda ${i + 1}/${ALL_SEARCH_URLS.length})`);
          await new Promise(resolve => setTimeout(resolve, longPause));
        } else {
          // Delay normal entre búsquedas
          const delay = await humanWait(HUMAN_DELAYS.searchDelayMin, HUMAN_DELAYS.searchDelayMax);
          console.log(`   ⏳ Esperando ${Math.round(delay / 1000)}s antes de siguiente búsqueda...`);
        }
      }
    }

    const elapsedMinutes = Math.round((Date.now() - startTime) / 60000);
    console.log(`\n✓ Fase 1 completada en ~${elapsedMinutes} minutos`);
    console.log(`✓ Posts recopilados: ${allPosts.length}`);

    // ─── RESUMEN GLOBAL DE FILTRADO ───
    console.log('\n' + '═'.repeat(60));
    console.log('RESUMEN GLOBAL DE FILTRADO');
    console.log('═'.repeat(60));
    console.log(`   📊 Total cards procesadas: ${globalStats.totalCards}`);
    console.log(`   ❌ Descartadas por actividad: ${globalStats.discardedActivity}`);
    console.log(`   ❌ Descartadas por repost: ${globalStats.discardedRepost}`);
    console.log(`   ❌ Descartadas sin keyword: ${globalStats.discardedNoKeyword}`);
    console.log(`   ❌ Descartadas snippet corto (<${MIN_SNIPPET_LENGTH} chars): ${globalStats.discardedShortSnippet}`);
    console.log(`   ❌ Descartadas sin URL: ${globalStats.discardedNoUrl}`);
    console.log(`   ✅ Posts válidos aceptados: ${globalStats.accepted}`);
    console.log(`   📝 Posts únicos finales: ${allPosts.length}`);
    console.log('═'.repeat(60));

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

    // ─── FASE 3: VERIFICACIÓN DE POSTS ORIGINALES ───
    // Visitamos cada post para confirmar que es original y extraer datos reales
    if (VERIFY_POSTS && allPosts.length > 0) {
      console.log('\n' + '─'.repeat(60));
      console.log('FASE 3: Verificación de posts originales');
      console.log('─'.repeat(60));
      console.log(`   Verificando ${allPosts.length} posts candidatos...`);

      const verifiedPosts = [];

      for (const post of allPosts) {
        const verification = await verifyAndExtractPost(page, post.url);

        if (verification.isOriginal) {
          // Actualizar con datos reales del post
          const realAuthor = verification.realAuthor || post.author;
          const realSnippet = verification.realSnippet || post.snippet;
          // Re-detectar idioma con el snippet real (más preciso)
          const detectedLanguage = detectLanguage(realSnippet);
          verifiedPosts.push({
            ...post,
            author: realAuthor,
            title: realAuthor, // Sincronizar title con author
            likes: verification.realLikes || post.likes,
            comments: verification.realComments || post.comments,
            reposts: verification.realReposts || post.reposts,
            snippet: realSnippet,
            language: detectedLanguage,
            total: (verification.realLikes || post.likes) +
                   (verification.realComments || post.comments) +
                   (verification.realReposts || post.reposts),
            verified: true,
          });
        }

        // Delay entre verificaciones para no sobrecargar
        await page.waitForTimeout(VERIFY_DELAY);
      }

      console.log(`\n   ✅ Posts verificados como originales: ${verifiedPosts.length}/${allPosts.length}`);

      // Reemplazar allPosts con los verificados
      allPosts.length = 0;
      allPosts.push(...verifiedPosts);
    }

    // ─── SELECCIÓN DE TOP 3 DEL DÍA ───
    console.log('\n' + '─'.repeat(60));
    console.log('SELECCIÓN DE TOP 3 DEL DÍA');
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

    console.log(`\n📊 Resumen del día:`);
    console.log(`   Posts totales recolectados: ${allPosts.length}`);
    console.log(`   Posts con métricas: ${postsWithMetrics.length}`);
    console.log(`   Posts sin métricas (con snippet): ${postsWithoutMetrics.length}`);
    console.log(`   Top 3 seleccionados: ${top3.length}`);

    if (top3.length > 0) {
      console.log(`\n🏆 Top 3 del día:`);
      top3.forEach((p, i) => {
        const metrics = (p.total || 0) > 0 ? `${p.total} interacciones` : `${(p.snippet || '').length} chars`;
        const authorDisplay = p.author || 'Autor desconocido';
        const lang = p.language || 'EN';
        console.log(`   ${i + 1}. [${lang}] ${authorDisplay} (${metrics}) - ${p.keywordId || p.keyword}`);
      });
    }

    // ─── FECHA DE HOY ───
    const today = new Date().toISOString().slice(0, 10);

    // ─── ESCRIBIR data.json (TOP 3 DEL DÍA) ───
    const output = {
      lastUpdated: new Date().toISOString(),
      date: today,
      keywords: KEYWORDS_CONFIG.map(k => ({ id: k.id, label: k.label })),
      posts: top3,
      allPosts: allPosts, // Todos los posts del día (para filtrado en frontend)
    };

    await mkdir('public', { recursive: true });
    await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
    console.log(`\n✅ Top 3 del día guardado en: ${OUTPUT_PATH}`);

    // ─── ACTUALIZAR HISTÓRICO (solo Top 3 de cada día) ───
    console.log('\n' + '─'.repeat(60));
    console.log('ACTUALIZANDO HISTÓRICO (Top 3 de cada día)');
    console.log('─'.repeat(60));

    let history = await loadHistory();
    const historyBefore = history.length;

    // Solo añadir los Top 3 del día al histórico
    history = mergeHistory(history, top3, today);
    const newPostsAdded = history.length - historyBefore;

    await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
    console.log(`   📚 Histórico: ${historyBefore} → ${history.length} posts (+${newPostsAdded} nuevos)`);
    console.log(`   ✅ Guardado en: ${HISTORY_PATH}`);

    // ─── GENERAR TOP 10 ALL-TIME ───
    console.log('\n' + '─'.repeat(60));
    console.log('GENERANDO TOP 10 ALL-TIME');
    console.log('─'.repeat(60));

    const top10 = generateTop10(history);

    // Escribir como ARRAY puro (no objeto)
    await writeFile(TOP10_PATH, JSON.stringify(top10, null, 2), 'utf8');

    console.log(`\n🏆 Top 10 All-Time:`);
    top10.forEach((p, i) => {
      const authorDisplay = p.author || 'Autor desconocido';
      const score = calcScore(p);
      console.log(`   ${i + 1}. ${authorDisplay} (score: ${score} = ${p.likes} likes + ${p.comments} comments) - ${p.date}`);
    });

    console.log(`\n✅ Top 10 guardado en: ${TOP10_PATH}`);

    wroteOutput = true;
    console.log('\n' + '═'.repeat(60));
    console.log('✅ PROCESO COMPLETADO');
    console.log('═'.repeat(60) + '\n');

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
