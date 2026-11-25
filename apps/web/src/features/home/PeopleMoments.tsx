import { Link } from 'react-router-dom';
import { Award, Sparkles } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { useEmployees } from '@/features/employee/api/employees';
import { formatDate, today } from '@/features/leave/format';
import { daysFrom, nextAnniversary, relativeDays } from './dates';
import { RowsSkeleton, Widget } from './Widget';

const WINDOW = 30;

/**
 * New joiners and work anniversaries in the next month: the small things an HR
 * person of one would otherwise keep in a spreadsheet. From join dates the API
 * already returned; birthdays are left out — date of birth is personal data,
 * not everyone may see it, and a dashboard is not the place to spread it.
 */
export function PeopleMoments() {
  const t = today();
  const employees = useEmployees();
  const people = (employees.data ?? []).filter((e) => e.status !== 'EXITED');

  const joining = people
    .filter((e) => Math.abs(daysFrom(t, e.joinDate)) <= WINDOW && daysFrom(t, e.joinDate) >= -14)
    .sort((a, b) => b.joinDate.localeCompare(a.joinDate));

  const anniversaries = people
    .map((e) => ({ e, next: nextAnniversary(e.joinDate, t) }))
    .filter(({ next }) => next.years >= 1 && daysFrom(t, next.on) <= WINDOW)
    .sort((a, b) => a.next.on.localeCompare(b.next.on));

  const empty = joining.length === 0 && anniversaries.length === 0;

  return (
    <Widget title="Moments" icon={Sparkles}>
      {employees.isLoading ? (
        <RowsSkeleton rows={2} />
      ) : empty ? (
        <EmptyState compact icon={Award} title="A quiet month" description="New joiners and work anniversaries will show up here." />
      ) : (
        <ul className="space-y-3">
          {joining.slice(0, 3).map((e) => {
            const name = `${e.firstName} ${e.lastName ?? ''}`.trim();
            const future = e.joinDate > t;
            return (
              <Row key={`j-${e.id}`} id={e.id} name={name} note={future ? `Joins ${formatDate(e.joinDate)} · ${relativeDays(e.joinDate, t)}` : `Joined ${formatDate(e.joinDate)}`} tag={future ? 'Joining' : 'New'} />
            );
          })}
          {anniversaries.slice(0, 4).map(({ e, next }) => {
            const name = `${e.firstName} ${e.lastName ?? ''}`.trim();
            return (
              <Row key={`a-${e.id}`} id={e.id} name={name} note={`${next.years} ${next.years === 1 ? 'year' : 'years'} · ${formatDate(next.on)}`} tag={next.on === t ? 'Today' : relativeDays(next.on, t)} />
            );
          })}
        </ul>
      )}
    </Widget>
  );
}

function Row({ id, name, note, tag }: { id: string; name: string; note: string; tag: string }) {
  return (
    <li>
      <Link to={`/employees/${id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-accent">
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{note}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{tag}</span>
      </Link>
    </li>
  );
}
