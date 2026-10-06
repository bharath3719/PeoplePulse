import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { newPasswordSchema } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAcceptInvitation, useInvitationPreview } from './api/auth';

/**
 * Where an invitation link lands (/invite#<token>).
 *
 * Reachable signed in or not: the CA firm's accountant accepting a second
 * company is usually signed in to their first. Accepting signs them in to the
 * company that invited them.
 *
 * One form, two meanings. A new address chooses a password; an address that
 * already has a login proves it with that login's password. Which one is the
 * server's call — the preview says.
 */
export function AcceptInvitation() {
  const token = useLocation().hash.slice(1);
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();
  const [passwordError, setPasswordError] = useState<string>();

  if (!token) {
    return <Notice title="This link is incomplete" body="Open the full link from your invitation." />;
  }
  if (preview.isPending) {
    return <Frame><p className="text-sm text-muted-foreground">Checking your invitation…</p></Frame>;
  }
  if (preview.isError) {
    return <Notice title="We can't use this invitation" body={preview.error.message} />;
  }

  const { email, companyName, roles, hasAccount } = preview.data;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password') ?? '');

    if (!hasAccount) {
      const strong = newPasswordSchema.safeParse(password);
      if (!strong.success) {
        setPasswordError(strong.error.errors[0]?.message);
        return;
      }
    }

    setPasswordError(undefined);
    accept.mutate({ token, password }, {
      // A hard navigation: anything cached belongs to whichever company this
      // browser was signed in to before.
      onSuccess: () => window.location.assign('/'),
      onError: (error) => {
        if (error instanceof ApiError) {
          setPasswordError(error.fieldErrors.find((f) => f.field === 'password')?.message);
        }
      },
    });
  }

  const unattributed = accept.error instanceof ApiError && accept.error.fieldErrors.length === 0
    ? accept.error.message
    : null;

  return (
    <Frame>
      <CardHeader>
        <CardTitle>Join {companyName}</CardTitle>
        <CardDescription>
          {email} has been invited as {roles.join(', ') || 'a member'}.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {hasAccount && (
            <p className="text-sm text-muted-foreground">
              You already use PeoplePulse with this address. Enter your password to add {companyName} to
              your account &mdash; you&rsquo;ll be able to switch between companies from the header.
            </p>
          )}

          <Field
            label={hasAccount ? 'Your password' : 'Choose a password'}
            required
            error={passwordError}
            hint={hasAccount ? undefined : 'At least 12 characters. A phrase works well.'}
          >
            <Input
              name="password"
              type="password"
              autoComplete={hasAccount ? 'current-password' : 'new-password'}
              aria-invalid={Boolean(passwordError)}
              autoFocus
            />
          </Field>

          {unattributed && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{unattributed}</p>
          )}

          <Button type="submit" className="w-full" disabled={accept.isPending}>
            {accept.isPending ? 'Just a moment…' : `Join ${companyName}`}
          </Button>
        </form>
      </CardContent>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Frame>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link to="/login" className="text-sm text-primary hover:underline">Go to sign in</Link>
      </CardContent>
    </Frame>
  );
}
