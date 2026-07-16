import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type ColumnDef, type SortingState,
} from '@tanstack/react-table';
import { Search, Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PfStatusBadge, EsiStatusBadge } from '@/components/ui/pf-status-badge';
import { Can, usePermissions } from '@/features/auth/permissions';
import { useEmployees, type Employee } from './api/employees';

export function EmployeeList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const { can } = usePermissions();
  const { data: employees = [], isLoading } = useEmployees(search || undefined);

  /**
   * Columns are BUILT from permissions, not hidden with a conditional inside the
   * cell renderer.
   *
   * The difference matters: a column that is filtered out here never reaches the
   * DOM, never appears in a CSV export of the table, and cannot be revealed by
   * fiddling with CSS. A column that renders `{can(...) && value}` is still a
   * column — it is just empty, and the header still tells you it exists.
   */
  const columns = useMemo<ColumnDef<Employee>[]>(() => {
    const base: ColumnDef<Employee>[] = [
      {
        accessorKey: 'empCode',
        header: 'Code',
        cell: ({ row }) => (
          <Link
            to={`/employees/${row.original.id}`}
            className="tabular text-sm font-medium text-primary hover:underline"
          >
            {row.original.empCode}
          </Link>
        ),
      },
      {
        id: 'name',
        header: 'Name',
        accessorFn: (e) => `${e.firstName} ${e.lastName ?? ''}`.trim(),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">
              {row.original.firstName} {row.original.lastName}
            </div>
            {row.original.workEmail && (
              <div className="text-xs text-muted-foreground">{row.original.workEmail}</div>
            )}
          </div>
        ),
      },
      { accessorKey: 'joinDate', header: 'Joined', cell: ({ getValue }) => (
        <span className="tabular text-sm">{String(getValue())}</span>
      ) },
      {
        accessorKey: 'pfStatus',
        header: 'PF',
        cell: ({ getValue }) => <PfStatusBadge status={String(getValue())} />,
      },
      {
        accessorKey: 'esiStatus',
        header: 'ESI',
        cell: ({ getValue }) => <EsiStatusBadge status={String(getValue())} />,
      },
    ];

    // Only exists for someone holding `employee.identifiers.view`. The server
    // has already stripped the data; this stops us rendering an empty column.
    if (can('employee.identifiers.view')) {
      base.push({
        id: 'pan',
        header: 'PAN',
        // Masked from panLast4 — the server decrypted nothing to produce this.
        cell: ({ row }) => (
          <span className="tabular text-xs text-muted-foreground">
            {row.original.panMasked ?? '—'}
          </span>
        ),
      });
    }

    base.push({
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => (
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {String(getValue()).toLowerCase()}
        </span>
      ),
    });

    return base;
  }, [can]);

  const table = useReactTable({
    data: employees,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="text-sm text-muted-foreground">
            {employees.length} {employees.length === 1 ? 'person' : 'people'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Can I="employee.import">
            <Button variant="outline" onClick={() => navigate('/import')}>
              <Upload className="h-4 w-4" />
              Import
            </Button>
          </Can>
          <Can I="employee.create">
            <Button onClick={() => navigate('/employees/new')}>
              <Plus className="h-4 w-4" />
              Add employee
            </Button>
          </Can>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or code…"
          className="pl-9"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className="cursor-pointer px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}

            {!isLoading && employees.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <p className="text-muted-foreground">
                    {search ? `Nobody matches “${search}”.` : 'No employees yet.'}
                  </p>
                  {!search && (
                    <Can I="employee.import">
                      <p className="mt-1 text-sm text-muted-foreground">
                        Import your existing team from a spreadsheet to get started.
                      </p>
                    </Can>
                  )}
                </td>
              </tr>
            )}

            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
