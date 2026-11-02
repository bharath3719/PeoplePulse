import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { toIstDate } from '@peoplepulse/core';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/features/auth/permissions';
import { InviteUser } from './InviteUser';
import { ManageMember } from './ManageMember';
import { useAccess, useRevokeInvitation, type EmployeeRef, type RoleRef } from './api/users';

/**
 * Who can sign in to this company, and who has been asked to (D-16).
 *
 * Logins, not employees: an external accountant appears here and nowhere in
 * People, and most employees will not appear here until they are invited to
 * self-service. Changing or removing someone's access is `user.manage`, offered
 * only on the rows the server says are within the admin's reach.
 */
export function UserAccess() {
  const { session, can } = usePermissions();
  const access = useAccess();
  const revoke = useRevokeInvitation();
  // `?invite=<employee id>` — from "Invite to sign in" on an employee's profile.
  const [params, setParams] = useSearchParams();
  const inviteFor = params.get('invite') ?? undefined;
  const [inviting, setInviting] = useState(Boolean(inviteFor));
  const [managingId, setManagingId] = useState<string | null>(null);

  const members = access.data?.members ?? [];
  const invitations = access.data?.invitations ?? [];
  // Looked up afresh on every render, so the panel closes itself when the list
  // refreshes without them in it.
  const managing = members.find((m) => m.userId === managingId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Who can sign in to this company, and what they can do there.
          </p>
        </div>
        {!inviting && (
          <Button onClick={() => setInviting(true)}>
            <UserPlus className="h-4 w-4" />
            Invite user
          </Button>
        )}
      </div>

      {inviting && (
        <InviteUser
          {...(inviteFor && { employeeId: inviteFor })}
          onDone={() => {
            setInviting(false);
            if (inviteFor) setParams({}, { replace: true });
          }}
        />
      )}

      {managing && <ManageMember key={managing.userId} member={managing} onDone={() => setManagingId(null)} />}

      {access.isLoading && <p className="text-muted-foreground">Loading…</p>}

      {invitations.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Invited</h2>
          <Table head={['Email', 'Access', 'Expires', '']}>
            {invitations.map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">
                  {i.email}
                  <SignsInAs employee={i.employee} />
                </td>
                <td className="px-4 py-3"><Roles roles={i.roles} /></td>
                <td className="tabular px-4 py-3 text-sm">
                  {i.expired
                    ? <span className="text-destructive">Expired — invite again</span>
                    : toIstDate(new Date(i.expiresAt))}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(i.id)}
                  >
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
          {revoke.isError && <p className="text-sm text-destructive">{revoke.error.message}</p>}
        </section>
      )}

      {access.data && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Can sign in</h2>
          <Table head={['Email', 'Access', 'Since', '']}>
            {members.map((m) => (
              <tr key={m.userId} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">
                  {m.email}
                  {m.userId === session?.userId && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                  )}
                  <SignsInAs employee={m.employee} />
                </td>
                <td className="px-4 py-3"><Roles roles={m.roles} /></td>
                <td className="tabular px-4 py-3 text-sm">{toIstDate(new Date(m.joinedAt))}</td>
                <td className="px-4 py-3 text-right">
                  {can('user.manage') && m.manageable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={m.userId === managingId}
                      onClick={() => setManagingId(m.userId)}
                    >
                      Manage
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </section>
      )}
    </div>
  );
}

/** Which employee a login is — whose leave and payslips are "theirs" (D-26). */
function SignsInAs({ employee }: { employee: EmployeeRef | null }) {
  if (!employee) return null;
  return (
    <p className="text-xs font-normal text-muted-foreground">
      as {employee.name} <span className="tabular">{employee.empCode}</span>
    </p>
  );
}

function Roles({ roles }: { roles: RoleRef[] }) {
  if (roles.length === 0) return <span className="text-sm text-muted-foreground">No roles</span>;
  return <span className="text-sm">{roles.map((r) => r.name).join(', ')}</span>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
