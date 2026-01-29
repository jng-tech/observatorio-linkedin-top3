export async function onRequestGet() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Top 3 LinkedIn (ESG x Tech)</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #0d1117;
      color: #f0f6fc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }

    .login-container {
      background-color: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 360px;
    }

    .login-header {
      text-align: center;
      margin-bottom: 1.5rem;
    }

    .login-header h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .login-header p {
      color: #8b949e;
      font-size: 0.875rem;
    }

    .form-group {
      margin-bottom: 1rem;
    }

    label {
      display: block;
      font-size: 0.75rem;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    input[type="password"] {
      width: 100%;
      padding: 0.75rem 1rem;
      background-color: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #f0f6fc;
      font-size: 1rem;
      transition: border-color 0.2s ease;
    }

    input[type="password"]:focus {
      outline: none;
      border-color: #58a6ff;
    }

    button {
      width: 100%;
      padding: 0.75rem 1rem;
      background-color: #238636;
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }

    button:hover {
      background-color: #2ea043;
    }

    .error-message {
      background-color: rgba(248, 81, 73, 0.1);
      border: 1px solid #f85149;
      color: #f85149;
      padding: 0.75rem;
      border-radius: 6px;
      font-size: 0.875rem;
      margin-bottom: 1rem;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-header">
      <h1>Top 3 LinkedIn (ESG x Tech)</h1>
      <p>Introduce el token de acceso</p>
    </div>

    <form method="POST" action="/login">
      <div class="form-group">
        <label for="token">Token</label>
        <input
          type="password"
          id="token"
          name="token"
          autocomplete="current-password"
          required
          autofocus
        >
      </div>

      <button type="submit">Acceder</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8'
    }
  });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);

  // Parsear form data
  const formData = await request.formData();
  const token = (formData.get('token') || '').toString().trim();

  // Validar token
  if (!token || token !== env.APP_TOKEN) {
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Top 3 LinkedIn (ESG x Tech)</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #0d1117;
      color: #f0f6fc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }

    .login-container {
      background-color: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 360px;
    }

    .login-header {
      text-align: center;
      margin-bottom: 1.5rem;
    }

    .login-header h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .login-header p {
      color: #8b949e;
      font-size: 0.875rem;
    }

    .form-group {
      margin-bottom: 1rem;
    }

    label {
      display: block;
      font-size: 0.75rem;
      color: #8b949e;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    input[type="password"] {
      width: 100%;
      padding: 0.75rem 1rem;
      background-color: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #f0f6fc;
      font-size: 1rem;
      transition: border-color 0.2s ease;
    }

    input[type="password"]:focus {
      outline: none;
      border-color: #58a6ff;
    }

    button {
      width: 100%;
      padding: 0.75rem 1rem;
      background-color: #238636;
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }

    button:hover {
      background-color: #2ea043;
    }

    .error-message {
      background-color: rgba(248, 81, 73, 0.1);
      border: 1px solid #f85149;
      color: #f85149;
      padding: 0.75rem;
      border-radius: 6px;
      font-size: 0.875rem;
      margin-bottom: 1rem;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-header">
      <h1>Top 3 LinkedIn (ESG x Tech)</h1>
      <p>Introduce el token de acceso</p>
    </div>

    <div class="error-message">Token inválido</div>

    <form method="POST" action="/login">
      <div class="form-group">
        <label for="token">Token</label>
        <input
          type="password"
          id="token"
          name="token"
          autocomplete="current-password"
          required
          autofocus
        >
      </div>

      <button type="submit">Acceder</button>
    </form>
  </div>
</body>
</html>`;

    return new Response(html, {
      status: 401,
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  }

  // Token válido: setear cookie y redirigir
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/',
      'Set-Cookie': `auth=${env.APP_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Secure`
    }
  });
}
