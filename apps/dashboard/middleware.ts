import { NextResponse, type NextRequest } from 'next/server';
import { isHiddenMarketingPage } from '@/lib/marketing-scope';

const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password'];

/**
 * Pemeriksaan ringan di edge: hanya cek keberadaan cookie sesi untuk redirect.
 * Validasi sesi yang sebenarnya dilakukan API pada setiap request.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = req.cookies.has('smge_rt');
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  // A failed/offline logout can leave an httpOnly cookie. Allow explicit reauthentication.
  if (
    hasSession &&
    pathname === '/login' &&
    req.nextUrl.searchParams.get('reason') !== 'session-ended'
  ) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (isHiddenMarketingPage(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/outbound';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Lewati aset statis & proxy API
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)'],
};
