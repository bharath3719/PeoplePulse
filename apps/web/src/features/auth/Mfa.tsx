import { useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { mfaCodeSchema } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useConfirmMfaEnrolment, useStartMfaEnrolment, useVerifyMfa } from './api/auth';
import { usePermissions } from './permissions';

/**
 * Two-factor authentication: asking for a code, and setting up the app that
 * makes them.
 *
 * Everything here is UX. What stops an action without a second factor is the
 * API's PermissionGuard refusing `MFA_REQUIRED`; these components only arrange
 * for the user to have one before they ask.
 */

/**
 * One code, two uses: `verify` proves a set-up authenticator is to hand;
 * `confirm` proves a freshly scanned one works, and switches MFA on.
 */
export function MfaCodeForm({
  purpose,
  onDone,
}: {
  purpose: 'verify' | 'confirm';
  onDone?: () => void;
}) {
  const verify = useVerifyMfa();
  const confirm = useConfirmMfaEnrolment();
  const mutation = purpose === 'verify' ? verify : confirm;
  const [error, setError] = useState<string>();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = mfaCodeSchema.safeParse({ code: String(new FormData(e.currentTarget).get('code') ?? '') });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message);
      return;
    }

    setError(undefined);
    mutation.mutate(parsed.data.code, {
      onSuccess: () => onDone?.(),
      // A wrong code comes back against the field; a lockout (429) does not.
      onError: (err) =>
        setError(err instanceof ApiError ? (err.fieldErrors[0]?.message ?? err.message) : 'Something went wrong'),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="6-digit code" required error={error}>
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={7}
          placeholder="123 456"
          className="tabular text-lg tracking-widest"
          aria-invalid={Boolean(error)}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Checking…' : purpose === 'verify' ? 'Verify' : 'Turn on two-factor'}
      </Button>
    </form>
  );
}

/**
 * Set up an authenticator app: scan, then type the first code it shows.
 *
 * The secret is minted on a click, not on mount. Minting is a POST that
 * replaces any earlier unconfirmed secret, and an effect that runs twice
 * (StrictMode does exactly that) could leave the QR code on screen naming a
 * secret the server has already replaced.
 */
export function MfaEnrolment({ onDone }: { onDone?: () => void }) {
  const start = useStartMfaEnrolment();

  if (!start.data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          You&apos;ll need an authenticator app on your phone — Google Authenticator, Microsoft
          Authenticator, or any app that scans a sign-in QR code.
        </p>
        {start.error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{start.error.message}</p>
        )}
        <Button onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? 'Preparing…' : 'Set up authenticator app'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="text-sm"><span className="font-medium">1.</span> Scan this with your authenticator app.</p>
        <img
          src={start.data.qrCode}
          alt="QR code to add PeoplePulse to your authenticator app"
          className="mx-auto h-44 w-44 rounded-md border bg-white p-2"
        />
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Can&apos;t scan? Type this key instead
          </summary>
          <code className="tabular mt-2 block break-all rounded-md bg-muted px-3 py-2 text-xs tracking-wider">
            {start.data.secret.match(/.{1,4}/g)?.join(' ')}
          </code>
        </details>
      </div>

      <div className="space-y-3">
        <p className="text-sm"><span className="font-medium">2.</span> Enter the code it shows.</p>
        <MfaCodeForm purpose="confirm" onDone={onDone} />
      </div>
    </div>
  );
}

/** A code if the user has an authenticator; setting one up if not. */
export function MfaChallenge({ onDone }: { onDone?: () => void }) {
  const { session } = usePermissions();
  return session?.mfaEnrolled
    ? <MfaCodeForm purpose="verify" onDone={onDone} />
    : <MfaEnrolment onDone={onDone} />;
}

/**
 * Renders its children only on an MFA-verified session — otherwise asks for the
 * code (or setup) first, in place, so the user never fills in a form only to
 * have the API refuse it.
 *
 * Verifying swaps the token and refetches the session; `mfaVerified` turns true
 * and the children appear. No navigation, so nothing typed is lost.
 */
export function RequireMfa({ action, children }: { action: string; children: ReactNode }) {
  const { session } = usePermissions();
  if (session?.mfaVerified) return <>{children}</>;

  const enrolled = Boolean(session?.mfaEnrolled);
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          {enrolled ? 'Confirm it’s you' : 'Set up two-factor authentication'}
        </CardTitle>
        <CardDescription>
          {enrolled
            ? `${action} needs a code from your authenticator app.`
            : `${action} needs a code from an authenticator app. Setting one up takes a minute, once.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MfaChallenge />
      </CardContent>
    </Card>
  );
}
