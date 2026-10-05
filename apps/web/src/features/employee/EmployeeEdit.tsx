import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EMPLOYMENT_TYPES, GENDERS } from '@peoplepulse/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { PfStatusBadge } from '@/components/ui/pf-status-badge';
import { ApiError } from '@/lib/api';
import { Can } from '@/features/auth/permissions';
import { useOrg, type Org, type OrgUnit } from '@/features/org/api/org';
import { useEmployee, useEmployees, useUpdateEmployee, type Employee } from './api/employees';
import { editResolver, toFormValues, toPatch, type EditFormValues } from './edit-form';

/**
 * Correct an employee's details.
 *
 * A correction, not a transfer or a promotion: it fixes what was entered wrong
 * and leaves its trail in the audit log. Effective-dated changes (CHR-07) will
 * be their own actions.
 */
export function EmployeeEdit() {
  const { id = '' } = useParams();
  const { data: employee, isLoading } = useEmployee(id);
  const org = useOrg();
  const people = useEmployees();

  // Wait for the option lists too, not just the employee. A select's value is
  // set when the form mounts; if its <option>s arrive afterwards, the browser
  // shows "—" while the form still holds the real department — the screen and
  // the data disagree, and HR "corrects" a field that was never wrong.
  if (isLoading || !employee || org.isPending || people.isPending) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  // The form takes its defaults once, on mount. Keyed so a different employee
  // gets a fresh form, and so a background refetch never wipes what was typed.
  return <EditForm key={employee.id} employee={employee} org={org.data} people={people.data} />;
}

function EditForm({
  employee,
  org,
  people,
}: {
  employee: Employee;
  org: Org | undefined;
  people: Employee[] | undefined;
}) {
  const navigate = useNavigate();
  const update = useUpdateEmployee(employee.id);
  const profilePath = `/employees/${employee.id}`;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, dirtyFields, isDirty },
  } = useForm<EditFormValues>({ resolver: editResolver, defaultValues: toFormValues(employee) });

  const onSubmit = handleSubmit((values) => {
    update.mutate(toPatch(values, dirtyFields), {
      onSuccess: () => navigate(profilePath),
      onError: (error) => {
        // Rules only the server can check — a department from another company,
        // a reporting loop, facts locked by payroll — come back per field.
        if (error instanceof ApiError) {
          for (const fieldError of error.fieldErrors) {
            setError(fieldError.field as keyof EditFormValues, { message: fieldError.message });
          }
        }
      },
    });
  });

  const formError =
    update.error instanceof ApiError && update.error.fieldErrors.length === 0
      ? update.error.message
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={profilePath}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {employee.firstName} {employee.lastName}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Edit details</h1>
        <p className="tabular text-sm text-muted-foreground">{employee.empCode}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Who they are</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required error={errors.firstName?.message}>
              <Input {...register('firstName')} />
            </Field>
            <Field label="Last name" error={errors.lastName?.message}>
              <Input {...register('lastName')} />
            </Field>
            <Field label="Work email" error={errors.workEmail?.message}>
              <Input type="email" {...register('workEmail')} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input {...register('phone')} />
            </Field>
            <Can I="employee.view.all">
              <Field label="Date of birth" error={errors.dateOfBirth?.message}>
                <Input type="date" {...register('dateOfBirth')} />
              </Field>
              <Field label="Gender" error={errors.gender?.message}>
                <Select {...register('gender')}>
                  <option value="">Not specified</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {titleCase(g)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Personal email" error={errors.personalEmail?.message}>
                <Input type="email" {...register('personalEmail')} />
              </Field>
            </Can>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where they sit</CardTitle>
            <CardDescription>
              For fixing a wrong pick. Changes here are corrections: they are kept in the audit
              log, not recorded as a transfer or promotion in the employee&apos;s job history.
            </CardDescription>
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
            <OrgSelect
              label="Location"
              units={org?.locations}
              error={errors.locationId?.message}
              registration={register('locationId')}
            />
            <OrgSelect
              label="Department"
              units={org?.departments}
              error={errors.departmentId?.message}
              registration={register('departmentId')}
            />
            <OrgSelect
              label="Designation"
              units={org?.designations}
              error={errors.designationId?.message}
              registration={register('designationId')}
            />
            <OrgSelect
              label="Grade"
              units={org?.grades}
              error={errors.gradeId?.message}
              registration={register('gradeId')}
            />
            <Field label="Reports to" error={errors.managerId?.message}>
              <Select {...register('managerId')}>
                <option value="">—</option>
                {people
                  ?.filter((m) => m.id !== employee.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName ?? ''} ({m.empCode})
                    </option>
                  ))}
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Can I="employee.identifiers.view">
          <Card>
            <CardHeader>
              <CardTitle>Statutory</CardTitle>
              <CardDescription>
                Bank details are not changed here — redirecting someone&apos;s salary needs
                bank-edit access and two-factor sign-in.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                label="PAN"
                error={errors.pan?.message}
                hint={
                  employee.panMasked
                    ? `Currently ${employee.panMasked}. Leave blank to keep it.`
                    : 'ABCDE1234F'
                }
              >
                <Input
                  {...register('pan', { setValueAs: (v: string) => v.toUpperCase() })}
                  className="uppercase"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="UAN"
                error={errors.uan?.message}
                hint="12 digits. Having one means they were already a PF member."
              >
                <Input {...register('uan')} inputMode="numeric" autoComplete="off" />
              </Field>
              <Field label="ESIC number" error={errors.esicNumber?.message}>
                <Input {...register('esicNumber')} autoComplete="off" />
              </Field>
            </CardContent>
          </Card>
        </Can>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Joining and PF
              <PfStatusBadge status={employee.pfStatus} />
            </CardTitle>
            <CardDescription>
              PF status is decided from these facts at hire (ADR-004). Correcting one works it out
              again and records the change in the employee&apos;s history. They lock once the
              employee has been paid in a finalised payroll run.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Joining date" required error={errors.joinDate?.message}>
              <Input type="date" {...register('joinDate')} />
            </Field>
            <Can I="employee.salary.view">
              <Field
                label="PF wage at joining (₹)"
                error={errors.pfWageAtJoiningRupees?.message}
                hint="Basic + DA when they joined — not today's wage."
              >
                <Input type="number" step="0.01" min="0" {...register('pfWageAtJoiningRupees')} />
              </Field>
            </Can>

            <label className="flex items-start gap-2 sm:col-span-2">
              <input
                type="checkbox"
                {...register('hasPriorPfMembership')}
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <span className="text-sm">
                Already a PF member when they joined
                {errors.hasPriorPfMembership?.message && (
                  <span className="block text-xs font-medium text-destructive">
                    {errors.hasPriorPfMembership.message}
                  </span>
                )}
                <span className="block text-xs text-muted-foreground">
                  Stays ticked while a UAN is on file — a UAN is proof of prior membership.
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
          <Button type="submit" disabled={!isDirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(profilePath)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * A labelled select over one kind of org unit, with "—" for none.
 *
 * Takes the registration as a named prop: spread straight onto a function
 * component, its `ref` would be dropped and the form would never see the value.
 */
function OrgSelect({
  label,
  units,
  error,
  registration,
}: {
  label: string;
  units: OrgUnit[] | undefined;
  error: string | undefined;
  registration: UseFormRegisterReturn;
}) {
  return (
    <Field label={label} error={error}>
      <Select {...registration}>
        <option value="">—</option>
        {units?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}
