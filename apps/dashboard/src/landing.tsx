import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Clock3, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RachetLogo } from '@/components/RachetLogo';

const repository = 'https://github.com/socialrobot-io/reflow';

// GitHub mark from Simple Icons: https://github.com/simple-icons/simple-icons/blob/develop/icons/github.svg
function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-icon="inline-start">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function JourneyIllustration() {
  return (
    <figure className="hero-art" aria-label="Example activation welcome journey">
      <figcaption className="art-prompt">
        <span>YOU ASK</span>
        <p>“Welcome new users. If they haven’t activated after 24 hours, send one reminder.”</p>
      </figcaption>
      <svg className="hero-art-path" viewBox="0 0 400 430" preserveAspectRatio="none" fill="none" aria-hidden="true">
        <path d="M200 115V137M200 197V220M200 280V300Q200 310 190 310H102Q92 310 92 320V347M200 300Q200 310 210 310H298Q308 310 308 320V347M308 394V413" />
      </svg>
      <span className="art-trigger"><span /> User signs up</span>
      <div className="art-node art-welcome reflow-panel"><span className="art-node-icon"><Mail aria-hidden="true" /></span><span><small>SEND EMAIL</small><strong>Welcome aboard</strong></span></div>
      <div className="art-node art-wait reflow-panel"><span className="art-node-icon"><Clock3 aria-hidden="true" /></span><span><small>WAIT UP TO 24 HOURS</small><strong>Did they activate?</strong></span></div>
      <div className="art-outcome art-activated"><span className="art-branch-label">Yes</span><div className="art-outcome-node"><Check aria-hidden="true" /><span>End journey</span></div></div>
      <div className="art-outcome art-reminder"><span className="art-branch-label">Not yet</span><div className="art-outcome-node"><Mail aria-hidden="true" /><span>Send reminder</span></div><span className="art-end">Then end</span></div>
    </figure>
  );
}

export function LandingPage() {
  return (
    <div className="landing">
      <a className="landing-skip" href="#main">Skip to content</a>
      <header className="landing-header">
        <Link to="/welcome" className="landing-brand" aria-label="Rachet home"><RachetLogo /></Link>
        <nav aria-label="Main navigation"><a href={`${repository}#quick-start`}><span className="nav-dot nav-dot-mint" />Docs</a><a href={repository}><GitHubIcon />GitHub <ArrowUpRight aria-hidden="true" /></a></nav>
        <Button asChild variant="ghost" className="ml-auto rounded-full"><Link to="/login">Sign in <ArrowUpRight data-icon="inline-end" /></Link></Button>
      </header>
      <main className="landing-hero" id="main">
        <div className="hero-copy">
          <span className="hero-eyebrow"><span /> THE JOURNEY ENGINE FOR AI AGENTS</span>
          <h1>Build customer<br />journeys<br /><span className="hero-highlight">by asking.</span></h1>
          <p>Describe what should happen. Your agent builds the workflow.<br className="hero-desktop-break" /> Rachet keeps it moving for days, weeks, or months.</p>
          <div className="hero-actions"><Button asChild size="lg" className="h-12 rounded-full px-6"><Link to="/login">Build your first journey <ArrowRight data-icon="inline-end" /></Link></Button><Button asChild variant="ghost" size="lg" className="h-12 rounded-full px-4"><a href={repository}><GitHubIcon /> Explore the code</a></Button></div>
          <p className="hero-note">Your agent authors. You approve. Rachet runs.</p>
        </div>
        <JourneyIllustration />
      </main>
      <footer className="landing-footer"><span>Open source. Yours to run.</span><div><span>MCP native</span><span>Powered by Temporal</span><span>Self-hostable</span></div></footer>
    </div>
  );
}
