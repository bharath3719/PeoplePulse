import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MfaCodeForm, MfaEnrolment, RecoveryCodes } from './Mfa';
import { useRegenerateRecoveryCodes } from './api/auth';
import { usePermissions, type Session } from './permissions';

/**
 * The user's own sign-in security: two-factor authentication, set up ahead of
 * the moment an action asks for it — and, once it is on, the recovery codes
 * and the replacement for a lost or new phone.
 */
export function Security() {
  const { session } = usePermissions();
  if (!session) return null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Security</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Two-factor authentication</CardTitle>
          <CardDescription>
            A code from an app on your phone, on top of your password. Someone who learns your
            password still can&apos;t change bank details, run payroll, or manage access as you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {session.mfaEnrolled ? (
            <Enrolled session={session} />
          ) : (
            <div className="space-y-4">
              {session.mfaRequired && (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">
                  Your access here includes actions that need it.
                </p>
              )}
              <MfaEnrolment />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Changing either needs a session that has passed a code (or a recovery code):
 * the codes are as good as the phone, and a new phone replaces the old one.
 */
function Enrolled({ session }: { session: Session }) {
  const [task, setTask] = useState<'idle' | 'codes' | 'replace'>('idle');
  const regenerate = useRegenerateRecoveryCodes();
  const left = session.recoveryCodesLeft;

  function close() {
    regenerate.reset();
    setTask('idle');
  }

  if (task === 'replace') {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium">Replace your authenticator</p>
        <MfaEnrolment replacing onDone={close} onCancel={close} />
      </div>
    );
  }

  if (regenerate.data) return <RecoveryCodes codes={regenerate.data.recoveryCodes} onSaved={close} />;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="h-4 w-4 text-primary" />
        On. PeoplePulse asks for a code before changes that need one.
      </p>

      <p className={left === 0 ? 'rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {left === 0
          ? 'You have no recovery codes. If you lose your phone, you won’t be able to sign in without help — make a set now.'
          : `${left} of 10 recovery codes left.`}
      </p>

      {!session.mfaVerified ? (
        task === 'codes' ? (
          <div className="space-y-2">
            <p className="text-sm">Confirm it&apos;s you to change these.</p>
            <MfaCodeForm />
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setTask('codes')}>
            Manage recovery codes or authenticator
          </Button>
        )
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
            {regenerate.isPending ? 'Making codes…' : left === 0 ? 'Make recovery codes' : 'New recovery codes'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTask('replace')}>
            Replace authenticator
          </Button>
        </div>
      )}
      {regenerate.isError && <p className="text-sm text-destructive">{regenerate.error.message}</p>}
    </div>
  );
}
