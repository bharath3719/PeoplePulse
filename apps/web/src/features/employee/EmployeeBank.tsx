import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import { updateEmployeeBankSchema } from '@peoplepulse/core';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { usePermissions } from '@/features/auth/permissions';
import { RequireMfa } from '@/features/auth/Mfa';
import { useEmployee, useUpdateEmployeeBank, type Employee } from './api/employees';

/**
 * Change where an employee's salary is paid.
 *
 * Redirecting salary is the classic payroll fraud, so this sits behind its own
 * permission and a second factor, and the account number is typed twice: a
 * one-digit slip sends a month's pay to a stranger, and the bank will not send
 * it back.
 */
export function EmployeeBank() {
  const { id = '' } = useParams();
  const { can } = usePermissions();
  const { data: employee, isLoading } = useEmployee(id);

  if (!can('employee.bank.edit')) {
    return <p className="py-16 text-center text-muted-foreground">You don&apos;t have access to change bank details.</p>;
  }
  if (isLoading || !employee) return <p className="text-muted-foreground">Loading…</p>;

  const profilePath = `/employees/${employee.id}`;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link
          to={profilePath}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {employee.firstName} {employee.lastName}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Bank details</h1>
        <p className="tabular text-sm text-muted-foreground">{employee.empCode}</p>
      </div>

      <RequireMfa action="Changing where salary is paid">
        <BankForm employee={employee} />
      </RequireMfa>
    </div>
  );
}

/** The API's own rule, plus the one only a person can check: did they type it twice the same? */
const bankFormSchema = updateEmployeeBankSchema
  .extend({ confirmAccount: z.string() })
  .refine((v) => v.bankAccount === v.confirmAccount, {
    path: ['confirmAccount'],
    message: 'The account numbers don’t match',
  });

function BankForm({ employee }: { employee: Employee }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const update = useUpdateEmployeeBank(employee.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const profilePath = `/employees/${employee.id}`;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (name: string) => String(f.get(name) ?? '').trim();

    const parsed = bankFormSchema.safeParse({
      // Spaces are how people read account numbers off a passbook, not part of them.
      bankAccount: text('bankAccount').replace(/\s+/g, ''),
      confirmAccount: text('confirmAccount').replace(/\s+/g, ''),
      bankIfsc: text('bankIfsc').toUpperCase(),
      bankName: text('bankName') || null,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.errors.map((err) => [err.path.join('.'), err.message])));
      return;
    }

    setErrors({});
    const { confirmAccount: _, ...input } = parsed.data;
    update.mutate(input, {
      onSuccess: () => navigate(profilePath),
      onError: (error) => {
        if (!(error instanceof ApiError)) return;
        // The second factor lapsed with the token it rode on. Re-reading the
        // session puts the code prompt back in place of this form.
        if (error.code === 'MFA_REQUIRED') void qc.invalidateQueries({ queryKey: ['session'] });
        setErrors(Object.fromEntries(error.fieldErrors.map((err) => [err.field, err.message])));
      },
    });
  }

  const unattributed = update.error instanceof ApiError && update.error.fieldErrors.length === 0
    ? update.error.message
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Where salary is paid</CardTitle>
        <CardDescription>
          {employee.bankAccountMasked
            ? <>Currently <span className="tabular">{employee.bankAccountMasked}</span>{employee.bankIfsc && <> at <span className="tabular">{employee.bankIfsc}</span></>}. </>
            : 'No bank account on file yet. '}
          The change is recorded in the audit log.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Account number" required error={errors['bankAccount']}>
            <Input
              name="bankAccount"
              inputMode="numeric"
              autoComplete="off"
              className="tabular"
              aria-invalid={Boolean(errors['bankAccount'])}
            />
          </Field>
          <Field label="Account number, again" required error={errors['confirmAccount']}>
            <Input
              name="confirmAccount"
              inputMode="numeric"
              autoComplete="off"
              className="tabular"
              aria-invalid={Boolean(errors['confirmAccount'])}
            />
          </Field>
          <Field label="IFSC" required error={errors['bankIfsc']} hint="11 characters, on the cheque book or passbook.">
            <Input
              name="bankIfsc"
              defaultValue={employee.bankIfsc ?? ''}
              autoComplete="off"
              maxLength={11}
              className="tabular uppercase"
              aria-invalid={Boolean(errors['bankIfsc'])}
            />
          </Field>
          <Field label="Bank name" error={errors['bankName']}>
            <Input name="bankName" defaultValue={employee.bankName ?? ''} aria-invalid={Boolean(errors['bankName'])} />
          </Field>

          {unattributed && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{unattributed}</p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save bank details'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate(profilePath)}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
