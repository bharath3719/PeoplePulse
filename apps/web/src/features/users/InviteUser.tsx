import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { inviteUserSchema, toIstDate } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useEmployeeLogins, useGrantableRoles, useInviteUser, type PendingInvitation } from './api/users';

/**
 * Invite someone: they get an email with a link to accept.
 *
 * Naming the employee they are (D-26) links the login on accepting — which is
 * how an employee gets self-service. `employeeId` preselects one, for the
 * "Invite to sign in" button on an employee's profile.
 */
export function InviteUser({ onDone, employeeId: preset }: { onDone: () => void; employeeId?: string }) {
  const roles = useGrantableRoles();
  const people = useEmployeeLogins();
  const invite = useInviteUser();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [employeeId, setEmployeeId] = useState(preset ?? '');
  // Null until typed in: until then the address follows the chosen employee's
  // work email, so picking someone fills it in without a copy to go stale.
  const [typedEmail, setTypedEmail] = useState<string | null>(null);

  if (invite.data) return <InvitationSent invitation={invite.data.invitation} onDone={onDone} />;

  const unlinked = people.data?.filter((p) => !p.login) ?? [];
  const chosen = unlinked.find((p) => p.id === employeeId);
  const email = typedEmail ?? chosen?.workEmail ?? '';

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);

    // The same schema the API validates with, so the browser cannot accept
    // what the server will refuse.
    const parsed = inviteUserSchema.safeParse({
      email,
      roleIds: f.getAll('roleIds').map(String),
      employeeId: employeeId || undefined,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.errors.map((err) => [err.path.join('.'), err.message])));
      return;
    }

    setErrors({});
    invite.mutate(parsed.data, {
      onError: (error) => {
        if (error instanceof ApiError) {
          setErrors(Object.fromEntries(error.fieldErrors.map((err) => [err.field, err.message])));
        }
      },
    });
  }

  const unattributed = invite.error instanceof ApiError && invite.error.fieldErrors.length === 0
    ? invite.error.message
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invite someone</CardTitle>
        <CardDescription>
          They get an email with a link to choose a password &mdash; or, if they already use PeoplePulse for
          another company, to add this one to the login they have.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {unlinked.length > 0 && (
            <Field
              label="Signs in as"
              error={errors['employeeId']}
              hint="For an employee's own login: they'll see their own leave here, and their payslips once payroll runs."
            >
              <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Not an employee (an accountant, say)</option>
                {unlinked.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.empCode}){p.invitedAs ? ` — invited as ${p.invitedAs}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Email" required error={errors['email']}>
            <Input
              name="email"
              type="email"
              placeholder="ravi@ca-firm.in"
              value={email}
              onChange={(e) => setTypedEmail(e.target.value)}
              aria-invalid={Boolean(errors['email'])}
            />
          </Field>

          <Field
            label="Access"
            required
            error={errors['roleIds']}
            hint="Only roles that give nothing beyond your own access are listed."
          >
            {roles.isLoading && <p className="text-sm text-muted-foreground">Loading roles…</p>}
            <div className="space-y-2">
              {roles.data?.map((role) => (
                <label key={role.id} className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/40">
                  <input type="checkbox" name="roleIds" value={role.id} className="mt-0.5 h-4 w-4 rounded border-input" />
                  <div>
                    <p className="text-sm font-medium">{role.name}</p>
                    {role.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
                  </div>
                </label>
              ))}
            </div>
          </Field>

          {unattributed && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{unattributed}</p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? 'Sending…' : 'Send invitation'}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The link went to their inbox and nowhere else — so accepting proves they can
 * read that address's mail.
 */
function InvitationSent({ invitation, onDone }: { invitation: PendingInvitation; onDone: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MailCheck className="h-4 w-4" />
          Invitation sent to {invitation.email}
        </CardTitle>
        <CardDescription>
          {invitation.employee && <>Accepting signs them in as {invitation.employee.name}. </>}
          The link in it works once, only for that address, until{' '}
          {toIstDate(new Date(invitation.expiresAt))}. If it doesn&rsquo;t arrive, check their spam
          folder, or invite them again &mdash; the first link then stops working.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="ghost" onClick={onDone}>Done</Button>
      </CardContent>
    </Card>
  );
}
