import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getSetupStatus } from '@/api';
import { GitHubIcon, LandingFooter, LandingHeader, repository } from '@/landing';

export type Plan = {
  name: string;
  price: number;
  /** People who may start a journey each month before extra people apply. */
  limit: number;
  overage: boolean;
  features: string[];
};

// Keep in sync with docs/PRICING.md, which is the source of truth for prices and limits.
export const PLANS: Plan[] = [
  { name: 'Free', price: 0, limit: 500, overage: false, features: ['3 live journeys', 'Unlimited team members', '14-day history', 'Community support'] },
  { name: 'Solo', price: 12, limit: 5_000, overage: true, features: ['Unlimited journeys', 'Unlimited team members', '90-day history', 'Email support'] },
  { name: 'Growth', price: 29, limit: 15_000, overage: true, features: ['Unlimited journeys', 'Unlimited team members', '6-month history', 'Email support'] },
  { name: 'Scale', price: 59, limit: 50_000, overage: true, features: ['Unlimited journeys', 'Unlimited team members', '1-year history', 'Priority support'] },
];
export const OVERAGE_PER_THOUSAND = 2.5;
export const CONTACT_EMAIL = 'hey@rachet.dev';

type Cost = { total: number; extra: number };
export type Recommendation = { plan: Plan; index: number } & Cost;

const round = (value: number) => Math.round(value * 100) / 100;

/** Monthly cost of a plan for a volume, or null when the plan cannot take it. */
export function planCost(plan: Plan, people: number): Cost | null {
  if (people <= plan.limit) return { total: plan.price, extra: 0 };
  if (!plan.overage) return null;
  const extra = people - plan.limit;
  return { total: round(plan.price + (extra / 1000) * OVERAGE_PER_THOUSAND), extra };
}

/** Cheapest plan that fits; ties go to the bigger plan. Null means Enterprise. */
export function recommendPlan(people: number | null): Recommendation | null {
  if (people === null) return null;
  let best: Recommendation | null = null;
  PLANS.forEach((plan, index) => {
    const cost = planCost(plan, people);
    if (cost && (!best || cost.total <= best.total)) best = { plan, index, ...cost };
  });
  return best;
}

// The slider is logarithmic so small volumes get as much room as large ones.
const SLIDER_MIN = 100;
const SLIDER_MAX = PLANS[PLANS.length - 1].limit;
const SLIDER_STEPS = 1000;
const SLIDER_LOG_END = 950; // Anything past this means "more than 50,000".
const THUMB = 26;

export function sliderToPeople(value: number): number | null {
  if (value > SLIDER_LOG_END) return null;
  const raw = Math.exp(Math.log(SLIDER_MIN) + (value / SLIDER_LOG_END) * Math.log(SLIDER_MAX / SLIDER_MIN));
  const step = raw < 1000 ? 50 : raw < 10_000 ? 250 : 1000;
  return Math.min(SLIDER_MAX, Math.round(raw / step) * step);
}

export function peopleToSlider(people: number | null): number {
  if (people === null || people > SLIDER_MAX) return SLIDER_STEPS;
  return Math.round((Math.log(Math.max(SLIDER_MIN, people) / SLIDER_MIN) / Math.log(SLIDER_MAX / SLIDER_MIN)) * SLIDER_LOG_END);
}

const count = (value: number) => value.toLocaleString('en-US');
const euro = (value: number) => `€${Number.isInteger(value) ? value : value.toFixed(2)}`;
const short = (value: number) => (value >= 1000 ? `${value / 1000}k` : String(value));

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  // Controlled so a tap opens it on touch screens, where hover doesn't exist.
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button type="button" className="pricing-tip" aria-label={label} onClick={(event) => { event.preventDefault(); setOpen(true); }}>?</button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}><div className="pricing-tip-body">{children}</div></TooltipContent>
    </Tooltip>
  );
}

function SliderTick({ value, label }: { value: number; label: string }) {
  const position = value / SLIDER_STEPS;
  return <span className="pricing-tick" style={{ left: `calc(${position * 100}% + ${THUMB / 2 - position * THUMB}px)` }}>{label}</span>;
}

function Result({ recommendation, billingEnabled }: { recommendation: Recommendation | null; billingEnabled: boolean }) {
  if (!recommendation) {
    return (
      <div className="pricing-result" aria-live="polite">
        <div className="pricing-result-top"><strong>Enterprise</strong><span className="pricing-tag pricing-tag-candy">Best fit</span></div>
        <p className="pricing-amount">Custom</p>
        <p className="pricing-line">For more than 50,000 people a month. Or self-host for free, with no limits.</p>
        <ul className="pricing-features"><li>Custom volume</li><li>SSO and roles</li><li>Commercial license</li><li>SLA support</li></ul>
        <div className="pricing-actions">
          <Button asChild size="lg" className="h-11 flex-1 rounded-full px-5"><a href={`mailto:${CONTACT_EMAIL}`}>Talk to us <ArrowRight data-icon="inline-end" /></a></Button>
          <Button asChild variant="outline" size="lg" className="h-11 flex-1 rounded-full px-5"><a href={repository}><GitHubIcon /> Self-host</a></Button>
        </div>
      </div>
    );
  }
  const { plan, index, total, extra } = recommendation;
  const next = PLANS[index + 1];
  const startHref = plan.price === 0
    ? '/login'
    : billingEnabled
      ? `/login?next=${encodeURIComponent(`/settings/billing?plan=${plan.name.toLowerCase()}`)}`
      : '/login';
  return (
    <div className="pricing-result" aria-live="polite">
      <div className="pricing-result-top"><strong>{plan.name}</strong><span className="pricing-tag">Best fit</span></div>
      <p className="pricing-amount">{euro(total)}<small>{total === 0 ? 'forever' : '/ month'}</small></p>
      {extra > 0 ? (
        <p className="pricing-line pricing-line-mono">
          {euro(plan.price)} + {euro(round(total - plan.price))} for {count(extra)} extra
          <InfoTip label="About extra people">
            <ul>
              <li>Extra people cost €2.50 per 1,000, up to a monthly cap you set.</li>
              <li>It's off by default. When it's off, new people wait until you upgrade or the month resets.</li>
              {next && <li>That's {euro(round(next.price - total))} cheaper than {next.name}.</li>}
            </ul>
          </InfoTip>
        </p>
      ) : (
        <p className="pricing-line pricing-line-mono">
          Up to {count(plan.limit)} people a month
          <InfoTip label="What happens at the limit">
            {plan.overage ? (
              <ul>
                <li>We email you at 80% and 100%.</li>
                <li>You get a free 10% buffer.</li>
                <li>After that, pay €2.50 per 1,000 extra or upgrade. People already in a journey always keep going.</li>
              </ul>
            ) : 'New people wait until next month, or until you upgrade. People already in a journey keep going.'}
          </InfoTip>
        </p>
      )}
      <p className="pricing-line">
        <Mail aria-hidden="true" /> Plus sending, at your provider's price
        <InfoTip label="About sending costs">You connect your own email sending account. Your provider bills you for sending, and Rachet never adds a markup.</InfoTip>
      </p>
      <ul className="pricing-features">{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
      <div className="pricing-actions">
        <Button asChild size="lg" className="h-11 flex-1 rounded-full px-5"><Link to={startHref}>{plan.price === 0 ? 'Start for free' : `Start on ${plan.name}`} <ArrowRight data-icon="inline-end" /></Link></Button>
      </div>
    </div>
  );
}

function ComparePlans({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  // Rendered in the page markup (not a portal) so crawlers and agents read every detail.
  return (
    <dialog ref={dialog} className="pricing-dialog reflow-document" aria-labelledby="pricing-compare-title" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="pricing-dialog-head">
        <h2 id="pricing-compare-title">All plans</h2>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Close" onClick={() => dialog.current?.close()}><X /></Button>
      </div>
      <div className="pricing-table">
        <table>
          <thead><tr><th /><th>Free</th><th>Solo</th><th>Growth</th><th>Scale</th></tr></thead>
          <tbody>
            <tr><th>Price</th>{PLANS.map((plan) => <td key={plan.name}>{plan.price === 0 ? '€0' : `${euro(plan.price)}/month`}</td>)}</tr>
            <tr><th>People per month</th>{PLANS.map((plan) => <td key={plan.name}>{count(plan.limit)}</td>)}</tr>
            <tr><th>Extra people</th>{PLANS.map((plan) => <td key={plan.name}>{plan.overage ? '€2.50 per 1,000' : 'Wait for next month'}</td>)}</tr>
            <tr><th>Live journeys</th><td>3</td><td>Unlimited</td><td>Unlimited</td><td>Unlimited</td></tr>
            <tr><th>Team members</th>{PLANS.map((plan) => <td key={plan.name}>Unlimited</td>)}</tr>
            <tr><th>History</th><td>14 days</td><td>90 days</td><td>6 months</td><td>1 year</td></tr>
            <tr><th>Support</th><td>Community</td><td>Email</td><td>Email</td><td>Priority email</td></tr>
            <tr><th>Agent authoring, simulation, ops console</th><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
          </tbody>
        </table>
      </div>
      <ul className="pricing-notes">
        <li>Each person counts once a month, however many journeys they enter. People partway through a journey don't count again, and stored contacts are free.</li>
        <li>Sending goes through your own email account and is billed by your provider, with no markup.</li>
        <li>Self-hosting is free under AGPL-3.0. Enterprise adds SSO, audit logs, a commercial license and an SLA. Contact {CONTACT_EMAIL}.</li>
        <li>Prices are in EUR and exclude VAT. Billing is monthly and you can cancel anytime.</li>
      </ul>
    </dialog>
  );
}

export function PricingPage() {
  const [people, setPeople] = useState<number | null>(3000);
  const [draft, setDraft] = useState('3000');
  const [billingEnabled, setBillingEnabled] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const recommendation = recommendPlan(people);
  const slider = peopleToSlider(people);

  useEffect(() => {
    void getSetupStatus().then((status) => setBillingEnabled(status.billingEnabled)).catch(() => setBillingEnabled(false));
  }, []);

  function changeSlider(value: number) {
    const next = sliderToPeople(value);
    setPeople(next);
    setDraft(next === null ? '' : String(next));
  }

  function changeDraft(value: string) {
    setDraft(value);
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return;
    setPeople(parsed > SLIDER_MAX ? null : Math.max(0, parsed));
  }

  return (
    <div className="landing pricing">
      <a className="landing-skip" href="#main">Skip to content</a>
      <LandingHeader />
      <main className="pricing-main" id="main">
        <div className="pricing-intro">
          <span className="hero-eyebrow"><span /> PRICING</span>
          <h1>Bring your own key. <span className="hero-highlight">Pay only for journeys.</span></h1>
          <p>
            Sending goes through your own email account, at your provider's price.
            <InfoTip label="Why bring your own key">
              <ul>
                <li>Your sender reputation and domains stay yours. No pool shared with other customers.</li>
                <li>No markup on sending. Many providers have a free tier.</li>
                <li>Delivery logs and bounces stay in your provider's dashboard.</li>
                <li>If you leave Rachet, your sending setup doesn't change.</li>
              </ul>
            </InfoTip>
          </p>
        </div>

        <section className="pricing-calc reflow-panel" aria-label="Find your plan">
          <div className="pricing-ask">
            <div className="pricing-question">
              <label htmlFor="pricing-people">How many people start a journey each month?</label>
              <InfoTip label="Who counts">
                <ul>
                  <li>New signups, trial users, anyone your journeys will email.</li>
                  <li>Each person counts once a month, however many journeys they enter.</li>
                  <li>People partway through a journey don't count again next month.</li>
                  <li>Contacts you only store are free.</li>
                </ul>
              </InfoTip>
            </div>
            <div className="pricing-readout">
              <input id="pricing-people" type="number" inputMode="numeric" min={0} step={50} value={draft} placeholder="50k+" onChange={(event) => changeDraft(event.target.value)} />
              <span>a month</span>
              <span className="pricing-perday">≈ {people === null ? '1,650+' : count(Math.max(1, Math.round(people / 30)))} a day</span>
            </div>
            <div className="pricing-slider">
              <input type="range" min={0} max={SLIDER_STEPS} value={slider} aria-label="People starting a journey each month" aria-valuetext={people === null ? 'More than 50,000' : count(people)} style={{ '--fill': `${(slider / SLIDER_STEPS) * 100}%` } as CSSProperties} onChange={(event) => changeSlider(Number(event.target.value))} />
              <div className="pricing-ticks" aria-hidden="true">
                {/* The last plan's limit sits beside the end of the track, so the end label stands for both. */}
                {PLANS.slice(0, -1).map((plan) => <SliderTick key={plan.name} value={peopleToSlider(plan.limit)} label={short(plan.limit)} />)}
                <SliderTick value={SLIDER_STEPS} label={`${short(SLIDER_MAX)}+`} />
              </div>
            </div>
          </div>
          <Result recommendation={recommendation} billingEnabled={billingEnabled} />
        </section>

        <div className="pricing-plans" aria-label="Every plan at this volume">
          {PLANS.map((plan, index) => {
            const cost = people === null ? null : planCost(plan, people);
            const best = recommendation?.index === index;
            const note = !cost ? `Includes ${count(plan.limit)}`
              : cost.extra ? `${euro(plan.price)} + ${count(cost.extra)} extra` : `Includes ${count(plan.limit)}`;
            return (
              <div key={plan.name} className="pricing-plan" data-best={best || undefined} data-unavailable={!cost || undefined}>
                <span className="pricing-plan-name">{plan.name}</span>
                <span className="pricing-plan-price">{cost ? euro(cost.total) : 'Over limit'}</span>
                <span className="pricing-plan-note">{note}</span>
              </div>
            );
          })}
        </div>

        <div className="pricing-more">
          <span><strong>Self-host free</strong><InfoTip label="About self-hosting">The full engine under AGPL-3.0, with nothing held back. Unlimited people and journeys. You run the infrastructure.</InfoTip></span>
          <span><strong>Enterprise</strong><InfoTip label="About Enterprise">For more than 50,000 people a month, or companies that need SSO, audit logs, roles, a commercial license and an SLA.</InfoTip></span>
          <button type="button" className="pricing-compare" onClick={() => dialog.current?.showModal()}>Compare all plans</button>
          <span className="pricing-fineprint">EUR, excl. VAT · monthly, cancel anytime</span>
        </div>
      </main>
      <LandingFooter />
      <ComparePlans dialog={dialog} />
    </div>
  );
}
