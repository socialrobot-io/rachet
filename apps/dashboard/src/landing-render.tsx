import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from './landing';

export function renderLanding() {
  return renderToString(<MemoryRouter><LandingPage /></MemoryRouter>);
}
