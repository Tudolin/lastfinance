import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PREFIXES = [
  '/login',
  '/setup',
  '/api/',
  '/offline',
  '/manifest.webmanifest',
  '/sw.js',
  '/icons/',
  '/favicon',
];

function csp(nonce: string) {
  const isDev = process.env.NODE_ENV === 'development';
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    // Estilos inline (atributo style) são usados por gráficos; não executam código.
    `style-src 'self' 'unsafe-inline'`,
    `font-src 'self'`,
    `img-src 'self' blob: data: https://*.pluggy.ai`,
    // Widget Pluggy Connect (iframe + chamadas à API com o connect token)
    `frame-src 'self' https://*.pluggy.ai`,
    `connect-src 'self' https://*.pluggy.ai`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

/**
 * Executa antes de cada página: gera o nonce da CSP e manda para /login quem não tem cookie de sessão.
 * A validação real da sessão (e do bloqueio) acontece no servidor, na camada de dados.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has('__Host-lf_session') || request.cookies.has('lf_session');
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = csp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|api/|sw.js|manifest.webmanifest|icons/|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
