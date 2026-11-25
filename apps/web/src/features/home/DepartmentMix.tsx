import { Network } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useEmployees } from '@/features/employee/api/employees';
import { useOrg } from '@/features/org/api/org';
import { Bar, RowsSkeleton, Widget } from './Widget';

/** Headcount by department: who is where, at a glance. */
export function DepartmentMix() {
  const employees = useEmployees();
  const org = useOrg();

  const names = new Map((org.data?.departments ?? []).map((d) => [d.id, d.name]));
  const counts = new Map<string, number>();
  for (const e of employees.data ?? []) {
    if (e.status === 'EXITED') continue;
    const key = e.departmentId ?? '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([id, count]) => ({ id, name: id ? names.get(id) ?? 'Unknown' : 'No department', count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const max = rows[0]?.count ?? 0;
  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <Widget title="Where people work" icon={Network} link={{ to: '/employees', label: 'Directory' }}>
      {employees.isLoading || org.isLoading ? (
        <RowsSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={Network} title="No one here yet" description="Departments fill in as you add people." />
      ) : (
        <ul className="space-y-3">
          {rows.slice(0, 7).map((r) => (
            <li key={r.id || 'none'} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className={r.id ? 'truncate' : 'truncate text-muted-foreground'}>{r.name}</span>
                <span className="figures shrink-0 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{r.count}</span> · {Math.round((r.count / total) * 100)}%
                </span>
              </div>
              <Bar value={r.count} max={max} />
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
