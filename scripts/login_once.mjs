/**
 * login_once.mjs
 *
 * Abre LinkedIn en modo visible para login manual + 2FA.
 * Espera a que el usuario llegue al feed y entonces guarda la sesión.
 *
 * Uso: npm run login
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN COMPARTIDA (debe coincidir con fetch_top3.mjs)
// ─────────────────────────────────────────────────────────────────────────────

const STATE_DIR = 'state';
const STATE_PATH = `${STATE_DIR}/linkedin.json`;

// UserAgent y viewport FIJOS - deben ser idénticos en fetch_top3.mjs
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const VIEWPORT = { width: 1280, height: 900 };

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

function isOnFeed(url) {
  return url.includes('/feed') || url.includes('/mynetwork') || url.includes('/in/');
}

function isOnLoginOrCheckpoint(url, title) {
  const urlLower = url.toLowerCase();
  const titleLower = (title || '').toLowerCase();

  return (
    urlLower.includes('/login') ||
    urlLower.includes('/checkpoint') ||
    urlLower.includes('/authwall') ||
    titleLower.includes('iniciar sesión') ||
    titleLower.includes('sign in') ||
    titleLower.includes('log in')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // Crear directorio state/ si no existe
  mkdirSync(STATE_DIR, { recursive: true });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║          LOGIN MANUAL DE LINKEDIN (Playwright)               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('Abriendo navegador...\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ]
  });

  // Contexto con UserAgent y Viewport FIJOS
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: VIEWPORT,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  });

  const page = await context.newPage();

  try {
    await page.goto('https://www.linkedin.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
  } catch (err) {
    console.error('Error al cargar LinkedIn:', err.message);
    await browser.close();
    process.exit(1);
  }

  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│  INSTRUCCIONES:                                              │');
  console.log('│                                                              │');
  console.log('│  1. Loguéate con tu email y contraseña en la ventana.        │');
  console.log('│  2. Completa el 2FA/checkpoint si LinkedIn lo solicita.      │');
  console.log('│  3. Navega hasta el feed (linkedin.com/feed).                │');
  console.log('│  4. Vuelve aquí y pulsa ENTER para guardar la sesión.        │');
  console.log('│                                                              │');
  console.log('│  IMPORTANTE: Asegúrate de estar en el feed antes de pulsar   │');
  console.log('│  ENTER. Si no, la sesión no funcionará en modo headless.     │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('\n⏳ Esperando a que completes el login...\n');

  // Esperar a que el usuario pulse ENTER
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise((resolve) => {
    rl.question('Pulsa ENTER cuando estés en el feed de LinkedIn... ', () => {
      rl.close();
      resolve();
    });
  });

  // Verificar estado actual
  const currentUrl = page.url();
  const currentTitle = await page.title();

  console.log(`\n📍 URL actual: ${currentUrl}`);
  console.log(`📄 Título: ${currentTitle}`);

  // Verificar si estamos en login/checkpoint
  if (isOnLoginOrCheckpoint(currentUrl, currentTitle)) {
    console.log('\n❌ ERROR: Aún estás en la página de login o checkpoint.');
    console.log('   Por favor, completa el login y navega al feed antes de guardar.');
    console.log('   Ejecuta de nuevo: npm run login\n');
    await browser.close();
    process.exit(1);
  }

  // Verificar si estamos en el feed
  if (!isOnFeed(currentUrl)) {
    console.log('\n⚠️  ADVERTENCIA: No parece que estés en el feed.');
    console.log('   URL esperada: https://www.linkedin.com/feed/');
    console.log('   Guardando sesión de todos modos, pero podría no funcionar.\n');
  } else {
    console.log('\n✓ Detectado: estás en el feed de LinkedIn');
  }

  // Esperar un poco para asegurar que las cookies se han establecido
  console.log('\nEsperando a que se estabilice la sesión...');
  await page.waitForTimeout(2000);

  // Guardar estado de la sesión
  console.log('Guardando sesión...');
  await context.storageState({ path: STATE_PATH });

  console.log(`\n✅ Session saved: ${STATE_PATH}`);
  console.log('\n📋 Configuración guardada:');
  console.log(`   UserAgent: ${USER_AGENT.substring(0, 50)}...`);
  console.log(`   Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log('\nAhora puedes ejecutar: npm run fetch\n');

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
