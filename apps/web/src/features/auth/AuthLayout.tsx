import type { ReactNode } from 'react';
import { CalendarCheck2, Clock3, ShieldCheck, Users } from 'lucide-react';
import { Logo, LogoMark } from '@/components/brand/logo';

/**
 * The frame for signing in, signing up and accepting an invitation: the
 * product's case on the left (from a laptop up), the form on the right.
 *
 * Every line on the left describes something that is built and running. A
 * sign-in page that promises payroll before payroll exists is the first thing
 * a pilot customer would catch us out on.
 */
const POINTS = [
  { icon: Users, title: 'One record per person', body: 'PAN, UAN and ESIC kept once, with PF and ESI eligibility worked out for you.' },
  { icon: CalendarCheck2, title: 'Leave that adds up', body: 'Every balance is a ledger you can open, line by line, down to the half day.' },
  { icon: Clock3, title: 'Shifts, rosters, punches', body: 'Night shifts included. Punches are timed by the server and never edited.' },
  { icon: ShieldCheck, title: 'Locked down by default', body: 'Two-factor sign-in, and every company’s data walled off in the database itself.' },
];

export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <PulseBackdrop />
        <div className="relative flex items-center gap-2.5">
          <span className="rounded-lg bg-primary-foreground/15 p-1 ring-1 ring-primary-foreground/20">
            <LogoMark className="h-7 w-7 [&_rect]:fill-transparent" />
          </span>
          <span className="text-lg font-semibold tracking-tight">PeoplePulse</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            People, attendance and leave for Indian companies, in one place.
          </h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: Icon, title: t, body }) => (
              <li key={t} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/10 ring-1 ring-primary-foreground/15">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{t}</span>
                  <span className="block text-sm text-primary-foreground/75">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-primary-foreground/60">Built for companies of 10 to 200 people.</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

/** A faint, oversized pulse line behind the brand panel. Decoration only. */
function PulseBackdrop() {
  return (
    <svg viewBox="0 0 600 600" aria-hidden="true" className="pointer-events-none absolute -right-40 top-1/2 h-[140%] -translate-y-1/2 opacity-[0.08]">
      <path
        d="M0 330h160l50-120 80 220 60-160 30 60h220"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="28"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
