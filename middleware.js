// Vercel Edge Middleware - Redirect browsers, serve CLI tools
export const config = {
  matcher: ['/install', '/uninstall', '/ado-testforge.tar.gz'],
};

export default function middleware(request) {
  const userAgent = request.headers.get('user-agent') || '';
  const cliTools = ['curl', 'wget', 'httpie', 'fetch', 'powershell', 'invoke-webrequest'];
  const isCLI = cliTools.some(tool => userAgent.toLowerCase().includes(tool));
  
  if (!isCLI) {
    return Response.redirect(new URL('/', request.url), 302);
  }
  return;
}
