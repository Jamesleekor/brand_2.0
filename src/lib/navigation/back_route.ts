// App back buttons return to the parent screen, independent of browser history.
export function getAppBackRoute(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/teacher/')) {
    for (const parent of ['/teacher/secondary-jobs', '/teacher/control', '/teacher/auction', '/teacher/guild', '/teacher/raid']) {
      if (path.startsWith(`${parent}/`)) return parent;
    }
    return '/teacher';
  }
  for (const parent of ['/guild', '/achievement', '/raid']) {
    if (path.startsWith(`${parent}/`)) return parent;
  }
  return '/home';
}
