import { renderToString } from 'react-dom/server';
import { LoginPrerender } from './app-prerender';

export function renderLoginPrerender() {
  return renderToString(<LoginPrerender />);
}
