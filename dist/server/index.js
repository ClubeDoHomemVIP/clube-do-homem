export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') url.pathname = '/oferta.html';
    if (url.pathname === '/oferta') url.pathname = '/oferta.html';
    if (env.ASSETS?.fetch) return env.ASSETS.fetch(new Request(url, request));
    return new Response('Página indisponível', { status: 404 });
  }
};
