import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Info } from 'lucide-react';
import { useCompanySettings, useUpdateStatutory } from './api/company';

/**
 * Statutory registration (ADR-004) — the switch that decides whether PF and ESI
 * are computed at all, for anybody.
 *
 * The copy on this screen is doing real work. HR will assume "we have employees,
 * so obviously we have PF", and for a 12-person company that is wrong: EPF is
 * compulsory only at 20+ employees. Getting this wrong in either direction is a
 * compliance problem, so the screen has to explain, not just toggle.
 */
export function CompanySettings() {
  const { data: company, isLoading } = useCompanySettings();
  const update = useUpdateStatutory();

  if (isLoading || !company) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Company settings</h1>
        <p className="text-sm text-muted-foreground">{company.name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provident Fund (EPF)</CardTitle>
          <CardDescription>
            Only switch this on if your company is actually enrolled with EPFO. Registration is
            compulsory once you have 20 or more employees, and optional below that.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-input"
              checked={company.epfRegistered}
              onChange={(e) => update.mutate({ epfRegistered: e.target.checked })}
            />
            <div>
              <p className="text-sm font-medium">This company is registered for EPF</p>
              <p className="text-xs text-muted-foreground">
                While this is off, nobody has PF deducted — and that is correct, not a
                misconfiguration.
              </p>
            </div>
          </label>

          {company.epfRegistered && (
            <Field
              label="EPF establishment code"
              hint="From your EPFO registration, e.g. KN/BNG/12345"
            >
              <Input
                defaultValue={company.epfEstablishmentCode ?? ''}
                placeholder="KN/BNG/12345"
                onBlur={(e) => update.mutate({ epfEstablishmentCode: e.target.value })}
              />
            </Field>
          )}

          {company.epfRegistered && (
            <div className="flex gap-2 rounded-md bg-muted/60 p-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Switching this on does <strong>not</strong> enrol the people already on your books.
                PF membership is decided when someone joins: it depends on their starting wage and
                on whether they already had a PF account elsewhere. Enrolling your existing team is
                a separate step, so that nobody has money deducted without being told.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employees&rsquo; State Insurance (ESI)</CardTitle>
          <CardDescription>Covers employees earning up to ₹21,000 a month.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-input"
              checked={company.esiRegistered}
              onChange={(e) => update.mutate({ esiRegistered: e.target.checked })}
            />
            <div>
              <p className="text-sm font-medium">This company is registered for ESI</p>
              <p className="text-xs text-muted-foreground">
                Coverage is fixed at the start of each contribution period (April&ndash;September,
                October&ndash;March) and holds until it ends &mdash; even if someone&rsquo;s pay
                rises above the limit partway through.
              </p>
            </div>
          </label>
        </CardContent>
      </Card>

      {update.isPending && <p className="text-sm text-muted-foreground">Saving&hellip;</p>}
      {update.isError && (
        <p className="text-sm text-destructive">{(update.error as Error).message}</p>
      )}
    </div>
  );
}
