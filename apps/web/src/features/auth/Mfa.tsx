import { useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { mfaCodeSchema, mfaRecoveryCodeSchema } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  useConfirmMfaEnrolment, useRecoverMfa, useRefreshSession, useStartMfaEnrolment, useVerifyMfa,
} from './api/auth';
import { usePermissions } from './permissions';

/**
 * Two-factor authentication: asking for a code, and setting up the app that
 * makes them.
 *
 * Everything here is UX. What stops an action without a second factor is the
 * API's PermissionGuard refusing `MFA_REQUIRED`; these components only arrange
 * for the user to have one before they ask.
 */

/** A wrong code comes back against the field; a lockout (429) does not. */
function messageOf(err: unknown): string {
  return err instanceof ApiError ? (err.fieldErrors[0]?.message ?? err.message) : 'Something went wrong';
}

/** The 6-digit field and its button. The caller decides what the code is for. */
function CodeForm({
  label,
  pending,
  error,
  onCode,
}: {
  label: string;
  pending: boolean;
  error: string | undefined;
  onCode: (code: string) => void;
}) {
  const [invalid, setInvalid] = useState<string>();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = mfaCodeSchema.safeParse({ code: String(new FormData(e.currentTarget).get('code') ?? '') });
    if (!parsed.success) {
      setInvalid(parsed.error.errors[0]?.message);
      return;
    }
    setInvalid(undefined);
    onCode(parsed.data.code);
  }

  const shown = invalid ?? error;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="6-digit code" required error={shown}>
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={7}
          placeholder="123 456"
          className="tabular text-lg tracking-widest"
          aria-invalid={Boolean(shown)}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Checking…' : label}
      </Button>
    </form>
  );
}

/**
 * A code from the set-up authenticator — or, for a lost phone, one of the
 * recovery codes. Either way the result is an MFA-verified token.
 *
 * `onRecovered` lets the caller send someone who just used a recovery code
 * somewhere they can replace their authenticator; it defaults to `onDone`.
 */
export function MfaCodeForm({ onDone, onRecovered }: { onDone?: () => void; onRecovered?: () => void }) {
  const verify = useVerifyMfa();
  const [recovering, setRecovering] = useState(false);

  return (
    <div className="space-y-3">
      {recovering ? (
        <RecoveryCodeForm onDone={onRecovered ?? onDone} />
      ) : (
        <CodeForm
          label="Verify"
          pending={verify.isPending}
          error={verify.error ? messageOf(verify.error) : undefined}
          onCode={(code) => verify.mutate(code, { onSuccess: () => onDone?.() })}
        />
      )}
      <button
        type="button"
        onClick={() => setRecovering(!recovering)}
        className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
      >
        {recovering ? 'Use a code from your authenticator app' : 'Lost your phone? Use a recovery code'}
      </button>
    </div>
  );
}

function RecoveryCodeForm({ onDone }: { onDone?: () => void }) {
  const recover = useRecoverMfa();
  const [error, setError] = useState<string>();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = mfaRecoveryCodeSchema.safeParse({
      recoveryCode: String(new FormData(e.currentTarget).get('recoveryCode') ?? ''),
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message);
      return;
    }
    setError(undefined);
    recover.mutate(parsed.data.recoveryCode, {
      onSuccess: () => onDone?.(),
      onError: (err) => setError(messageOf(err)),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field
        label="Recovery code"
        required
        error={error}
        hint="One of the codes you saved when you set up two-factor. Each works once."
      >
        <Input
          name="recoveryCode"
          autoComplete="off"
          autoFocus
          placeholder="abcd-efgh-ijkm-nopq"
          className="tabular tracking-wider"
          aria-invalid={Boolean(error)}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={recover.isPending}>
        {recover.isPending ? 'Checking…' : 'Use recovery code'}
      </Button>
    </form>
  );
}

/**
 * Recovery codes, shown the one time they exist in the clear. The server keeps
 * only their hashes, so "I've saved them" is the last chance.
 */
export function RecoveryCodes({ codes, onSaved }: { codes: string[]; onSaved: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      // Clipboard refused. The codes are on screen and selectable.
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Save your recovery codes</p>
        <p className="text-sm text-muted-foreground">
          If you lose your phone, each of these signs you in once instead of a code. Keep them
          somewhere safe that isn&apos;t your phone &mdash; a password manager, or on paper. This is
          the only time they&apos;re shown.
        </p>
      </div>
      <ul className="tabular grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-muted px-4 py-3 text-sm">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        <Button type="button" onClick={onSaved}>I&apos;ve saved them</Button>
      </div>
    </div>
  );
}

/**
 * Set up an authenticator app — or replace one: scan, type the first code it
 * shows, then save the recovery codes that come back.
 *
 * The secret is minted on a click, not on mount. Minting is a POST that
 * replaces any earlier unconfirmed secret, and an effect that runs twice
 * (StrictMode does exactly that) could leave the QR code on screen naming a
 * secret the server has already replaced.
 *
 * The session is re-read only once the codes are saved: it is what flips
 * `mfaVerified`, and a parent like RequireMfa would swap this component out —
 * codes and all — the moment it did.
 */
export function MfaEnrolment({
  onDone,
  onCancel,
  replacing = false,
}: {
  onDone?: () => void;
  /** Offered until the new authenticator is confirmed — after that there is nothing to cancel. */
  onCancel?: () => void;
  replacing?: boolean;
}) {
  const start = useStartMfaEnrolment();
  const confirm = useConfirmMfaEnrolment();
  const refreshSession = useRefreshSession();

  if (confirm.data) {
    return (
      <RecoveryCodes
        codes={confirm.data.recoveryCodes}
        onSaved={() => {
          void refreshSession();
          onDone?.();
        }}
      />
    );
  }

  if (!start.data) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {replacing
            ? 'Your current authenticator keeps working until the new one is set up.'
            : 'You’ll need an authenticator app on your phone — Google Authenticator, Microsoft Authenticator, or any app that scans a sign-in QR code.'}
        </p>
        {start.error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{start.error.message}</p>
        )}
        <div className="flex gap-2">
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? 'Preparing…' : replacing ? 'Set up the new authenticator' : 'Set up authenticator app'}
          </Button>
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
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
        <CodeForm
          label="Turn on two-factor"
          pending={confirm.isPending}
          error={confirm.error ? messageOf(confirm.error) : undefined}
          onCode={(code) => confirm.mutate(code)}
        />
        {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}

/** A code if the user has an authenticator; setting one up if not. */
export function MfaChallenge({ onDone }: { onDone?: () => void }) {
  const { session } = usePermissions();
  return session?.mfaEnrolled
    ? <MfaCodeForm onDone={onDone} />
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
