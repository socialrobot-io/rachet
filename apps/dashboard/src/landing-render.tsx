import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from './components/ui/tooltip';
import { LandingPage } from './landing';
import { PricingPage } from './pricing';

export function renderLanding() {
  return renderToString(<MemoryRouter><LandingPage /></MemoryRouter>);
}

export function renderPricing() {
  return renderToString(<MemoryRouter initialEntries={['/pricing']}><TooltipProvider><PricingPage /></TooltipProvider></MemoryRouter>);
}
