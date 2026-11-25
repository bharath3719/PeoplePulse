import { PartyPopper } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { usePermissions } from '@/features/auth/permissions';
import { useHolidays } from '@/features/leave/api/leave';
import { formatDate, thisLeaveYear, today } from '@/features/leave/format';
import { dateTile, relativeDays } from './dates';
import { RowsSkeleton, Widget } from './Widget';

/** The next few holidays, reaching into next year's calendar near December. */
export function UpcomingHolidays() {
  const { can } = usePermissions();
  const year = thisLeaveYear();
  const t = today();
  const thisYear = useHolidays(year);
  const nextYear = useHolidays(year + 1);

  const upcoming = [...(thisYear.data ?? []), ...(nextYear.data ?? [])]
    .filter((h) => h.date >= t)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  return (
    <Widget
      title="Upcoming holidays"
      icon={PartyPopper}
      link={can('leave.manage') ? { to: '/leave/settings', label: 'Calendar' } : undefined}
    >
      {thisYear.isLoading ? (
        <RowsSkeleton rows={2} />
      ) : upcoming.length === 0 ? (
        <EmptyState
          compact
          icon={PartyPopper}
          title="No holidays ahead"
          description={can('leave.manage') ? 'Add this year’s holidays under Leave policy.' : 'Your company hasn’t added any yet.'}
        />
      ) : (
        <ul className="space-y-3">
          {upcoming.map((h) => {
            const tile = dateTile(h.date);
            return (
              <li key={h.id} className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border bg-muted/40 leading-none">
                  <span className="text-[10px] font-medium uppercase text-primary">{tile.month}</span>
                  <span className="figures mt-0.5 text-sm font-semibold">{tile.day}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{h.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDate(h.date)} · {relativeDays(h.date, t)}
                    {h.locationName && <> · {h.locationName} only</>}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}
