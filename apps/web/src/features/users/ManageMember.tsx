import { useState } from 'react';
import { updateMemberRolesSchema } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RequireMfa } from '@/features/auth/Mfa';
import { usePermissions } from '@/features/auth/permissions';
import {
  useGrantableRoles, useRemoveMember, useResetMemberMfa, useUpdateMemberRoles, type Member,
} from './api/users';

/**
 * Change what one person can do here, reset their second factor, or take their
 * access away — `user.manage`, so behind a verified code.
 *
 * The API decides who is within reach (someone else, holding nothing the admin
 * lacks) and which roles may be granted; this only offers what it will accept.
 */
export function ManageMember({ member, onDone }: { member: Member; onDone: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">Managing {member.email}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Close</Button>
      </div>
      <RequireMfa action="Changing someone’s access">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{member.email}</CardTitle>
            <CardDescription>Changes apply from their next click &mdash; they don&apos;t need to sign out.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <RolesForm member={member} onDone={onDone} />
            <ResetMfa member={member} />
            <Remove member={member} onDone={onDone} />
          </CardContent>
        </Card>
      </RequireMfa>
    </div>
  );
}

function RolesForm({ member, onDone }: { member: Member; onDone: () => void }) {
  const roles = useGrantableRoles();
  const update = useUpdateMemberRoles(member.userId);
  const [error, setError] = useState<string>();
  const held = new Set(member.roles.map((r) => r.id));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = updateMemberRolesSchema.safeParse({
      roleIds: new FormData(e.currentTarget).getAll('roleIds').map(String),
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message);
      return;
    }

    setError(undefined);
    update.mutate(parsed.data, {
      onSuccess: onDone,
      onError: (err) =>
        setError(err instanceof ApiError ? (err.fieldErrors[0]?.message ?? err.message) : 'Something went wrong'),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label="Access" error={error} hint="Only roles that give nothing beyond your own access are listed.">
        {roles.isLoading && <p className="text-sm text-muted-foreground">Loading roles…</p>}
        <div className="space-y-2">
          {roles.data?.map((role) => (
            <label key={role.id} className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/40">
              <input
                type="checkbox"
                name="roleIds"
                value={role.id}
                defaultChecked={held.has(role.id)}
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <div>
                <p className="text-sm font-medium">{role.name}</p>
                {role.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
              </div>
            </label>
          ))}
        </div>
      </Field>
      <Button type="submit" disabled={update.isPending}>
        {update.isPending ? 'Saving…' : 'Save access'}
      </Button>
    </form>
  );
}

/**
 * Whoever signs in with their password next can set up a new authenticator —
 * so the admin must know it is really them asking, by some route a stolen
 * password does not give.
 *
 * Rendered whether or not they have one: a successful reset refetches the list,
 * `mfaEnabled` turns false, and the confirmation must still be on screen.
 */
function ResetMfa({ member }: { member: Member }) {
  const reset = useResetMemberMfa(member.userId);
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-medium">Two-factor authentication</h3>
      {reset.isSuccess ? (
        <p className="text-sm">Reset. They&apos;ll set up a new authenticator the next time an action needs one.</p>
      ) : !member.mfaEnabled ? (
        <p className="text-sm text-muted-foreground">Not set up.</p>
      ) : confirming ? (
        <div className="space-y-3 rounded-md bg-muted px-3 py-3 text-sm">
          <p>
            Whoever next signs in with their password can set up a new authenticator. Before you
            reset it, make sure it&apos;s really them asking &mdash; in person, or on a number you
            already have for them, not a reply to an email.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={reset.isPending} onClick={() => reset.mutate()}>
              {reset.isPending ? 'Resetting…' : 'Yes, reset two-factor'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">For a lost or replaced phone.</p>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>Reset two-factor</Button>
        </div>
      )}
      {reset.isError && <p className="text-sm text-destructive">{reset.error.message}</p>}
    </section>
  );
}

function Remove({ member, onDone }: { member: Member; onDone: () => void }) {
  const { session } = usePermissions();
  const remove = useRemoveMember(member.userId);
  const [confirming, setConfirming] = useState(false);
  const company = session?.tenants.find((t) => t.id === session.tenantId)?.name ?? 'this company';

  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-medium">Remove access</h3>
      {confirming ? (
        <div className="space-y-3 rounded-md bg-destructive/10 px-3 py-3 text-sm">
          <p>
            {member.email} will lose all access to {company} straight away, and any invitations
            they&apos;ve sent will stop working. Their employee record, if they have one, is not
            affected.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: onDone })}
            >
              {remove.isPending ? 'Removing…' : 'Yes, remove'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">They can be invited back later.</p>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>Remove from {company}</Button>
        </div>
      )}
      {remove.isError && <p className="text-sm text-destructive">{remove.error.message}</p>}
    </section>
  );
}
