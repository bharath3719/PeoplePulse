import { useForm, type Resolver } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import { createEmployeeSchema, EMPLOYMENT_TYPES, GENDERS } from '@peoplepulse/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useOrg } from '@/features/org/api/org';
import { useCreateEmployee, useEmployees } from './api/employees';

type FormValues = z.input<typeof createEmployeeSchema>;

/**
 * An empty text input is `''`, but an ABSENT optional field is `undefined`, and
 * zod is right to tell them apart: `''` is not a valid email. Left alone, every
 * untouched optional field would report "Invalid email" the moment the user hit
 * Save.
 *
 * So we strip the blanks before validating, rather than loosening the schema —
 * the schema is shared with the API (ADR: one rule, one place), and relaxing it
 * here to make a form convenient would relax it for the server too.
 */
function withoutBlanks(values: FormValues): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => {
      if (v === '' || v === undefined || v === null) return false;
      if (typeof v === 'number' && Number.isNaN(v)) return false; // an empty number input
      return true;
    }),
  );
}

const resolver: Resolver<FormValues> = async (values) => {
  const parsed = createEmployeeSchema.safeParse(withoutBlanks(values));
  if (parsed.success) return { values: parsed.data as FormValues, errors: {} };

  const errors: Record<string, { type: string; message: string }> = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.');
    errors[path] ??= { type: issue.code, message: issue.message };
  }
  return { values: {} as FormValues, errors: errors as never };
};

export function EmployeeNew() {
  const navigate = useNavigate();
  const org = useOrg();
  const managers = useEmployees();
  const create = useCreateEmployee();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver,
    defaultValues: { employmentType: 'FULL_TIME', hasPriorPfMembership: false },
  });

  const onSubmit = handleSubmit((values) => {
    create.mutate(withoutBlanks(values), {
      onSuccess: (employee) => navigate(`/employees/${employee.id}`),
      onError: (error) => {
        // The server validates the same schema, but it also knows things the
        // browser cannot — that this empCode is already taken, for one. Those
        // come back per-field (TR-40); attach them to the input that caused them.
        if (error instanceof ApiError) {
          for (const fieldError of error.fieldErrors) {
            setError(fieldError.field as keyof FormValues, { message: fieldError.message });
          }
        }
      },
    });
  });

  const formError =
    create.error instanceof ApiError && create.error.fieldErrors.length === 0
      ? create.error.message
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/employees"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          People
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Add employee</h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Who they are</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee code" required error={errors.empCode?.message}>
              <Input {...register('empCode')} placeholder="EMP001" />
            </Field>
            <Field label="Joining date" required error={errors.joinDate?.message}>
              <Input type="date" {...register('joinDate')} />
            </Field>
            <Field label="First name" required error={errors.firstName?.message}>
              <Input {...register('firstName')} placeholder="Priya" />
            </Field>
            <Field label="Last name" error={errors.lastName?.message}>
              <Input {...register('lastName')} placeholder="Sharma" />
            </Field>
            <Field label="Date of birth" error={errors.dateOfBirth?.message}>
              <Input type="date" {...register('dateOfBirth')} />
            </Field>
            <Field label="Gender" error={errors.gender?.message}>
              <Select {...register('gender')} defaultValue="">
                <option value="">Not specified</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {titleCase(g)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Work email" error={errors.workEmail?.message}>
              <Input type="email" {...register('workEmail')} placeholder="priya@company.in" />
            </Field>
            <Field label="Personal email" error={errors.personalEmail?.message}>
              <Input type="email" {...register('personalEmail')} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input {...register('phone')} placeholder="+91 98450 12345" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where they sit</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Employment type" error={errors.employmentType?.message}>
              <Select {...register('employmentType')}>
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location" error={errors.locationId?.message}>
              <Select {...register('locationId')} defaultValue="">
                <option value="">—</option>
                {org.data?.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Department" error={errors.departmentId?.message}>
              <Select {...register('departmentId')} defaultValue="">
                <option value="">—</option>
                {org.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Designation" error={errors.designationId?.message}>
              <Select {...register('designationId')} defaultValue="">
                <option value="">—</option>
                {org.data?.designations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reports to" error={errors.managerId?.message}>
              <Select {...register('managerId')} defaultValue="">
                <option value="">—</option>
                {managers.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.firstName} {m.lastName ?? ''} ({m.empCode})
                  </option>
                ))}
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Statutory</CardTitle>
            <CardDescription>
              We do not collect Aadhaar. UAN identifies the employee to EPFO and is all PF needs.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="PAN" error={errors.pan?.message} hint="ABCDE1234F">
              <Input {...register('pan')} className="uppercase" autoComplete="off" />
            </Field>
            <Field
              label="UAN"
              error={errors.uan?.message}
              hint="12 digits. If they have one, they are already a PF member."
            >
              <Input {...register('uan')} inputMode="numeric" autoComplete="off" />
            </Field>
            <Field label="ESIC number" error={errors.esicNumber?.message}>
              <Input {...register('esicNumber')} autoComplete="off" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pay and PF eligibility</CardTitle>
            <CardDescription>
              These are the <em>inputs</em> to the PF and ESI decision, not the decision. The server
              works out whether this person is a PF member from these plus the company&apos;s EPF
              registration — see ADR-004.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Gross monthly pay (₹)"
              error={errors.grossMonthlyRupees?.message}
              hint="Decides ESI coverage (₹21,000 threshold)."
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                {...register('grossMonthlyRupees', { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="PF wage at joining (₹)"
              error={errors.pfWageAtJoiningRupees?.message}
              hint="Basic + DA. The ₹15,000 test for an excluded employee runs on this."
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                {...register('pfWageAtJoiningRupees', { valueAsNumber: true })}
              />
            </Field>

            <label className="flex items-start gap-2 sm:col-span-2">
              <input
                type="checkbox"
                {...register('hasPriorPfMembership')}
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <span className="text-sm">
                Already a PF member
                <span className="block text-xs text-muted-foreground">
                  An existing member stays a member even above ₹15,000. Getting this wrong is what
                  makes someone an &quot;excluded employee&quot; who should not have been.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        {formError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={isSubmitting || create.isPending}>
            {create.isPending ? 'Saving…' : 'Add employee'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/employees')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}
