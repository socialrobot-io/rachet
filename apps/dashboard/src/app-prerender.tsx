import { Home } from 'lucide-react';
import { RachetLogo } from '@/components/RachetLogo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function LoginCardHeader({ requiresSetup = false }: { requiresSetup?: boolean }) {
  return (
    <CardHeader className="flex flex-col items-start gap-0 pt-7 sm:pt-8">
      <a href="/welcome" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <Home className="size-4" aria-hidden="true" /> Back to home
      </a>
      <div className="mt-8 flex flex-col items-start gap-1">
        <RachetLogo className="h-10 w-auto" />
        <a href="https://socialrobot.io" className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">by Socialrobot</a>
      </div>
      <CardTitle className="mt-8 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
        {requiresSetup ? 'Set up your Rachet account' : 'Welcome back'}
      </CardTitle>
      <CardDescription className="mt-2 text-base leading-relaxed">
        {requiresSetup
          ? 'Create the first administrator and the deployment’s organization.'
          : 'Sign in to Rachet with a magic link or GitHub.'}
      </CardDescription>
    </CardHeader>
  );
}

export function LoginPrerender() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
      <Card className="login-card w-full max-w-md gap-0 py-0 shadow-[0_1px_0_rgb(0_0_0/0.03),0_18px_40px_rgb(15_25_35/0.06)] [--card-spacing:--spacing(7)] sm:[--card-spacing:--spacing(8)]">
        <LoginCardHeader />
        <CardContent className="pt-7 pb-8" aria-busy="true">
          <div className="flex flex-col gap-4" aria-hidden="true">
            <div className="h-11 rounded-lg bg-muted/60" />
            <div className="h-11 rounded-lg bg-muted/60" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
