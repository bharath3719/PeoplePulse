import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { inviteUserSchema, toIstDate } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { invitationLink, useGrantableRoles, useInviteUser, type PendingInvitation } from './api/users';

/**
 * Invite someone, then hand the inviter the link to send.
 *
 * There is no email delivery yet, so the link IS the invitation — and it is
 * shown exactly once, because the server keeps only a hash of it.
 */
export function InviteUser({ onDone }: { onDone: () => void }) {
  const roles = useGrantableRoles();
  const invite = useInviteUser();
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (invite.data) {
    return <InvitationLink invitation={invite.data.invitation} token={invite.data.token} onDone={onDone} />;
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);

    // The same schema the API validates with, so the browser cannot accept
    // what the server will refuse.
    const parsed = inviteUserSchema.safeParse({
      email: String(f.get('email') ?? ''),
      roleIds: f.getAll('roleIds').map(String),
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
          They get a link to choose a password &mdash; or, if they already use PeoplePulse for
          another company, to add this one to the login they have.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email" required error={errors['email']}>
            <Input name="email" type="email" placeholder="ravi@ca-firm.in" aria-invalid={Boolean(errors['email'])} />
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
              {invite.isPending ? 'Creating…' : 'Create invitation link'}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function InvitationLink({
  invitation,
  token,
  onDone,
}: {
  invitation: PendingInvitation;
  token: string;
  onDone: () => void;
}) {
  const link = invitationLink(token);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard refused (permissions, an old browser). The field is selectable.
      setCopied(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Send this link to {invitation.email}</CardTitle>
        <CardDescription>
          It works once, only for that address, until {toIstDate(new Date(invitation.expiresAt))}.
          PeoplePulse doesn&rsquo;t email invitations yet, and this is the only time the link is
          shown &mdash; if it&rsquo;s lost, invite them again and the old one stops working.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            readOnly
            value={link}
            aria-label="Invitation link"
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <Button type="button" variant="ghost" onClick={onDone}>Done</Button>
      </CardContent>
    </Card>
  );
}
