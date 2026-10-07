import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { MfaEnrolment } from './Mfa';
import { usePermissions } from './permissions';

/**
 * The user's own sign-in security. For now, one thing: two-factor
 * authentication, set up ahead of the moment an action asks for it.
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
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              On. PeoplePulse asks for a code before changes that need one.
            </p>
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
