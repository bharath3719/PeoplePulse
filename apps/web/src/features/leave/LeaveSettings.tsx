import { useState } from 'react';
import { payrollMonthOf, toIstDate } from '@peoplepulse/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HolidaysSection } from './HolidaysSection';
import { LeaveTypesSection } from './LeaveTypesSection';
import { useLeaveSettings, usePostAccruals, useUpdateLeaveSettings } from './api/leave';
import { WEEKDAYS, problem } from './format';

/**
 * Leave policy (`leave.manage`): the types on offer, holidays, weekly offs, and
 * posting the year's credits. The route is reachable by anyone who types it;
 * every change on it is refused by the API without the permission.
 */
export function LeaveSettings() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Leave policy</h1>
        <p className="text-sm text-muted-foreground">What leave this company offers, and when nobody is expected at work.</p>
      </div>
      <LeaveTypesSection />
      <WeeklyOffs />
      <HolidaysSection />
      <PostAccruals />
    </div>
  );
}

function WeeklyOffs() {
  const settings = useLeaveSettings();
  const update = useUpdateLeaveSettings();
  // Server state, read straight from the query: no local copy to go stale.
  const offs = new Set(settings.data?.weeklyOffDays ?? []);

  function toggle(day: number) {
    const next = new Set(offs);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    update.mutate({ weeklyOffDays: [...next] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Weekly offs</CardTitle>
        <CardDescription>
          The days working-day leave skips, for the whole company until shift rosters arrive. Changing
          them does not re-count leave already requested.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {WEEKDAYS.map((name, day) => (
            <label key={name} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={offs.has(day)}
                disabled={!settings.data || update.isPending}
                onChange={() => toggle(day)}
              />
              {name}
            </label>
          ))}
        </div>
        {update.isError && <p className="mt-2 text-sm text-destructive">{update.error.message}</p>}
      </CardContent>
    </Card>
  );
}

function PostAccruals() {
  const post = usePostAccruals();
  const [through, setThrough] = useState<string>(payrollMonthOf(toIstDate(new Date())));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Post leave credits</CardTitle>
        <CardDescription>
          Grants each yearly type for the year, and credits each monthly type for every month up to
          the one you pick. Safe to run again: anything already posted is skipped.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            post.mutate({ through });
          }}
        >
          <Field label="Up to and including">
            <Input type="month" value={through} onChange={(e) => setThrough(e.target.value)} className="w-44" />
          </Field>
          <Button type="submit" disabled={post.isPending || !through}>
            {post.isPending ? 'Posting…' : 'Post credits'}
          </Button>
        </form>
        {post.data && (
          <p className="text-sm">
            Posted {post.data.posted} {post.data.posted === 1 ? 'credit' : 'credits'} through {post.data.through}
            {post.data.alreadyPosted > 0 && <> — {post.data.alreadyPosted} were already there</>}.
          </p>
        )}
        {post.isError && <p className="text-sm text-destructive">{problem(post.error)}</p>}
      </CardContent>
    </Card>
  );
}
