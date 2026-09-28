import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Keep SPA navigation consistent with the server's indexing policy.
export function RouteMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    const pricing = pathname === '/pricing';
    const indexable = pricing || pathname === '/' || pathname === '/welcome';
    document.title = pricing ? 'Rachet | Pricing' : indexable ? 'Rachet | Build customer journeys by asking' : 'Rachet | Dashboard';
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (robots) robots.content = indexable && !import.meta.env.DEV ? 'index, follow, max-image-preview:large' : 'noindex, nofollow';
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (indexable) {
      const url = document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content;
      if (url) {
        canonical ??= document.createElement('link');
        canonical.rel = 'canonical';
        canonical.href = new URL(pricing ? '/pricing' : '/', url).href;
        document.head.append(canonical);
      }
    } else {
      canonical?.remove();
    }
  }, [pathname]);
  return null;
}
