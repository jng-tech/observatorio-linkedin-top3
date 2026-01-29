export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Rutas públicas (no requieren autenticación)
  const publicPaths = [
    '/login',
    '/styles.css',
    '/app.js',
    '/data.json'
  ];

  if (publicPaths.includes(pathname)) {
    return next();
  }

  // Verificar cookie de autenticación
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = parseCookies(cookieHeader);
  const authToken = cookies['auth'];

  // Validar que el token existe y coincide con APP_TOKEN
  if (!authToken || authToken !== env.APP_TOKEN) {
    return Response.redirect(new URL('/login', url), 302);
  }

  return next();
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) {
      cookies[name] = rest.join('=');
    }
  });

  return cookies;
}
