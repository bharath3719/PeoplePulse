import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PfStatusBadge, EsiStatusBadge } from '@/components/ui/pf-status-badge';
import { Can } from '@/features/auth/permissions';
import { useEmployee, useRevealIdentifiers } from './api/employees';

export function EmployeeDetail() {
  const { id = '' } = useParams();
  const { data: employee, isLoading } = useEmployee(id);

  /**
   * Decryption is a SEPARATE, AUDITED call (TR-52), and it happens only when
   * someone deliberately asks for it — never as a side effect of opening the
   * page. Loading a profile must not write an audit entry saying you read
   * somebody's bank account, because then the audit log means nothing.
   */
  const [revealed, setRevealed] = useState(false);
  const { data: identifiers } = useRevealIdentifiers(id, revealed);

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
        <div className="flex gap-2">
          <PfStatusBadge status={employee.pfStatus} />
          <EsiStatusBadge status={employee.esiStatus} />
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
              {!revealed && (
                <Button variant="outline" size="sm" onClick={() => setRevealed(true)}>
                  <Eye className="h-4 w-4" /> Reveal
                </Button>
              )}
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
