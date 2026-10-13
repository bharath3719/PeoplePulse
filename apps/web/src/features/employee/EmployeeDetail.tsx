import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Eye, Landmark, Pencil, Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PfStatusBadge, EsiStatusBadge } from '@/components/ui/pf-status-badge';
import { Can } from '@/features/auth/permissions';
import { useDeleteEmployee, useEmployee, useRevealIdentifiers, type Employee } from './api/employees';

export function EmployeeDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const remove = useDeleteEmployee(id);
  const { data: employee, isLoading, error } = useEmployee(id, !remove.isSuccess);

  /**
   * Decryption is a SEPARATE, AUDITED call (TR-52), and it happens only when
   * someone deliberately asks for it — never as a side effect of opening the
   * page. Loading a profile must not write an audit entry saying you read
   * somebody's bank account, because then the audit log means nothing.
   */
  const [revealed, setRevealed] = useState(false);
  const { data: identifiers } = useRevealIdentifiers(id, revealed);

  // Before the loading check: once deleted, the profile is gone from the cache.
  if (remove.data) return <Deleted tier={remove.data.deleted} />;
  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="font-medium">
          {error instanceof ApiError && error.status === 404 ? 'No one here by that link.' : 'We couldn’t load this person.'}
        </p>
        <Link to="/employees" className="mt-2 inline-block text-sm text-primary hover:underline">Back to People</Link>
      </div>
    );
  }
  if (isLoading || !employee) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/employees"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Employees
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="tabular text-sm text-muted-foreground">{employee.empCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <PfStatusBadge status={employee.pfStatus} />
          <EsiStatusBadge status={employee.esiStatus} />
          <Can I="employee.edit">
            <Button variant="outline" size="sm" onClick={() => navigate(`/employees/${id}/edit`)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </Can>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employment</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <Detail label="Joined" value={employee.joinDate} mono />
          <Detail label="Status" value={employee.status.toLowerCase()} />
          <Detail label="Type" value={employee.employmentType.replace('_', ' ').toLowerCase()} />
          <Detail label="Email" value={employee.workEmail ?? '—'} />
        </CardContent>
      </Card>

      {/*
        This entire card is ABSENT for a user without `employee.identifiers.view`.
        The server has already stripped the fields from the payload; <Can> stops
        us rendering an empty shell that advertises they exist.
      */}
      <Can I="employee.identifiers.view">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Statutory &amp; bank
              <span className="flex items-center gap-2">
                <Can I="employee.bank.edit">
                  <Button variant="outline" size="sm" onClick={() => navigate(`/employees/${id}/bank`)}>
                    <Landmark className="h-4 w-4" /> Change bank details
                  </Button>
                </Can>
                {!revealed && (
                  <Button variant="outline" size="sm" onClick={() => setRevealed(true)}>
                    <Eye className="h-4 w-4" /> Reveal
                  </Button>
                )}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <Detail label="PAN" value={identifiers?.pan ?? employee.panMasked ?? '—'} mono />
            <Detail label="UAN" value={employee.uan ?? '—'} mono />
            <Detail
              label="Bank account"
              value={identifiers?.bankAccount ?? employee.bankAccountMasked ?? '—'}
              mono
            />
            <Detail label="IFSC" value={employee.bankIfsc ?? '—'} mono />

            {revealed && (
              <p className="col-span-2 text-xs text-muted-foreground">
                This view was recorded in the audit log.
              </p>
            )}
          </CardContent>
        </Card>
      </Can>

      <Can I="employee.delete">
        <DeleteEmployee employee={employee} remove={remove} />
      </Can>
    </div>
  );
}

/**
 * Irreversible either way, so it asks first. What actually happens depends on
 * whether they have been paid, which the server knows and the page does not —
 * so the confirmation explains both outcomes.
 */
function DeleteEmployee({
  employee,
  remove,
}: {
  employee: Employee;
  remove: ReturnType<typeof useDeleteEmployee>;
}) {
  const [confirming, setConfirming] = useState(false);
  const name = `${employee.firstName} ${employee.lastName ?? ''}`.trim();

  return (
    <section className="space-y-2 border-t pt-6">
      {confirming ? (
        <div className="space-y-3 rounded-md bg-destructive/10 px-4 py-3 text-sm">
          <p className="font-medium">Delete {name}?</p>
          <p>
            If they&apos;ve never been paid, their record is deleted completely &mdash; the right
            choice for a typo or a duplicate import. If they have been paid, their name, contact and
            bank details are erased, but their payroll records stay for the eight years the law
            requires. Either way, this can&apos;t be undone.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? 'Deleting…' : 'Yes, delete'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 className="h-4 w-4" /> Delete employee
        </Button>
      )}
      {remove.isError && <p className="text-sm text-destructive">{remove.error.message}</p>}
    </section>
  );
}

function Deleted({ tier }: { tier: 'HARD' | 'ANONYMISED' }) {
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <p className="font-medium">{tier === 'HARD' ? 'Deleted.' : 'Deleted, and payroll records kept.'}</p>
      <p className="text-sm text-muted-foreground">
        {tier === 'HARD'
          ? 'They had never been paid, so nothing of their record remains.'
          : 'Their personal details are erased. Their payroll and statutory records are retained, as the law requires.'}
      </p>
      <Link to="/employees" className="inline-block text-sm text-primary hover:underline">Back to People</Link>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={mono ? 'tabular' : ''}>{value}</p>
    </div>
  );
}
