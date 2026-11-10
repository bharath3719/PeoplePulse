import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCloseYear, usePreviewYearEnd, type LeaveYearEnd, type YearEndSkipReason } from './api/leave';
import { describeYearEnd, figure, problem, showDays, thisLeaveYear } from './format';

/**
 * Closing a leave year (LVE-02, D-25): each balance carries into the next year
 * as far as its type allows, then up to the encashment limit is set aside, and
 * the rest lapses. Preview first — the server runs the very close it would run
 * and rolls it back — then close.
 */
export function YearEndSection() {
  const current = thisLeaveYear();
  const [year, setYear] = useState(current - 1);
  const [confirming, setConfirming] = useState(false);
  const preview = usePreviewYearEnd();
  const close = useCloseYear();

  // Whichever was asked last, for the year on screen.
  const result = [close.data, preview.data].find((r) => r?.year === year);
  const error = close.error ?? preview.error;

  function choose(next: number) {
    setYear(next);
    setConfirming(false);
    preview.reset();
    close.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Close the leave year</CardTitle>
        <CardDescription>
          Moves what is left of each balance out of the year by its type&apos;s rule (At year end, above):
          carried into the next year, set aside to be encashed, or lapsed. Missing credits for the year
          are posted first. Closing again later moves only what has arrived since.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Year">
            <Select value={year} onChange={(e) => choose(Number(e.target.value))} className="w-32">
              {[current - 2, current - 1, current].map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </Field>
          <Button
            variant="outline"
            disabled={preview.isPending}
            onClick={() => {
              setConfirming(false);
              close.reset();
              preview.mutate({ year });
            }}
          >
            {preview.isPending ? 'Working it out…' : 'Preview'}
          </Button>
        </div>

        {result && <YearEndSummary result={result} />}

        {result?.dryRun && result.yearEnded && (
          confirming ? (
            <div className="space-y-3 rounded-md bg-destructive/10 px-4 py-3 text-sm">
              <p className="font-medium">Close {year}?</p>
              <p>
                Balances move as shown above, and each move is an entry in that person&apos;s leave history.
                It is not undone: a mistake is put right with an adjustment.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={close.isPending}
                  onClick={() => close.mutate({ year }, { onSuccess: () => { setConfirming(false); preview.reset(); } })}
                >
                  {close.isPending ? 'Closing…' : `Yes, close ${year}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setConfirming(true)}>Close {year}</Button>
          )
        )}

        {error && <p className="text-sm text-destructive">{problem(error)}</p>}
      </CardContent>
    </Card>
  );
}

function YearEndSummary({ result }: { result: LeaveYearEnd }) {
  const moved = result.types.filter((t) => t.people > 0);

  return (
    <div className="space-y-3 text-sm">
      {result.dryRun && !result.yearEnded && (
        <p className="rounded-md bg-muted px-3 py-2">
          {result.year} is still running. This is what closing would do if it ended today, with the rest
          of the year&apos;s credits posted. It can be closed from 1 January {result.year + 1}.
        </p>
      )}
      <p>
        {result.dryRun ? 'Closing would move' : `Closed ${result.year}: moved`} the balances of{' '}
        <span className="font-medium">{result.people} {result.people === 1 ? 'person' : 'people'}</span>
        {result.creditsPosted > 0 && (
          <>, after posting {result.creditsPosted} missing {result.creditsPosted === 1 ? 'credit' : 'credits'}</>
        )}
        .
      </p>

      {moved.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                {['Type', 'Rule', 'People', 'Carried', 'Encashed', 'Lapsed'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {moved.map((t) => (
                <tr key={t.leaveType.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{t.leaveType.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{describeYearEnd(t)}</td>
                  <td className="tabular px-3 py-2">{t.people}</td>
                  <td className="tabular px-3 py-2">{figure(t.carriedDays)}</td>
                  <td className="tabular px-3 py-2">{figure(t.encashedDays)}</td>
                  <td className="tabular px-3 py-2">{figure(t.lapsedDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.skipped.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">Left where they are — sort these out, then close again:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {result.skipped.map((s) => (
              <li key={`${s.employee.id}:${s.leaveType.id}`}>
                <span className="tabular text-xs text-muted-foreground">{s.employee.empCode}</span> {s.employee.name},{' '}
                {s.leaveType.name} ({showDays(s.balanceDays)}): {why(s.reason, s.pendingDays)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function why(reason: YearEndSkipReason, pendingDays: number): string {
  switch (reason) {
    case 'PENDING_REQUESTS': return `${showDays(pendingDays)} of leave still waiting for a decision`;
    case 'OVERDRAWN': return 'overdrawn — recover it, forgive it or dock it, with an adjustment';
    case 'EXITED': return 'left during the year, so full-and-final settlement takes care of it';
  }
}
