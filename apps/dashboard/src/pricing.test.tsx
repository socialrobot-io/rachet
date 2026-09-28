import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from './components/ui/tooltip';
import { PricingPage, peopleToSlider, recommendPlan, sliderToPeople } from './pricing';

describe('recommendPlan', () => {
  it.each([
    [400, 'Free', 0, 0],
    [3000, 'Solo', 12, 0],
    [7000, 'Solo', 17, 2000],
    [11_600, 'Solo', 28.5, 6600],
    [12_000, 'Growth', 29, 0],
    [20_000, 'Growth', 41.5, 5000],
    [30_000, 'Scale', 59, 0],
  ])('picks the cheapest plan for %i people', (people, name, total, extra) => {
    expect(recommendPlan(people)).toMatchObject({ plan: { name }, total, extra });
  });

  it('prefers the bigger plan when overage costs the same', () => {
    expect(recommendPlan(11_800)).toMatchObject({ plan: { name: 'Growth' }, total: 29 });
  });

  it('sends volumes past Scale to Enterprise', () => {
    expect(recommendPlan(null)).toBeNull();
  });
});

describe('pricing slider', () => {
  it('maps plan limits onto the slider and back', () => {
    for (const people of [500, 5000, 15_000, 50_000]) expect(sliderToPeople(peopleToSlider(people))).toBe(people);
    expect(sliderToPeople(1000)).toBeNull();
    expect(peopleToSlider(null)).toBe(1000);
  });
});

describe('PricingPage', () => {
  it('prerenders the recommendation and every plan detail for crawlers', () => {
    const html = renderToStaticMarkup(<MemoryRouter><TooltipProvider><PricingPage /></TooltipProvider></MemoryRouter>);
    expect(html).toContain('How many people start a journey each month?');
    expect(html).toContain('Start on Solo');
    expect(html).toContain('€59/month');
    expect(html).toContain('Self-hosting is free under AGPL-3.0');
  });
});
