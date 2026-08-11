import { escapeHtml } from './layout.mjs';

export function login({ error = '' } = {}) {
  const notice = error
    ? `<div class="flag forbid login-error" role="alert"><span class="flag-t">Access denied</span>${escapeHtml(error)}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in · Career Ops</title>
  <link href="/assets/hub.css" rel="stylesheet">
  <script src="/assets/hub.js" defer></script>
</head>
<body class="login-page">
  <main class="login-card">
    <p class="eyebrow">Career Ops Hub</p>
    <h1>Sign in</h1>
    ${notice}
    <form method="post" action="/login">
      <label for="token">Hub token</label>
      <input id="token" name="token" type="password" required autofocus autocomplete="current-password">
      <button type="submit">Continue</button>
    </form>
  </main>
</body>
</html>`;
}
