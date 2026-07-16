import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, Upload, AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { api } from '@/lib/api';

interface RowError {
  row: number;
  column: string;
  value: string;
  message: string;
}

interface ImportReport {
  totalRows: number;
  valid: number;
  errors: RowError[];
  dryRun: boolean;
  imported: number;
}

/**
 * Bulk import (CHR-09).
 *
 * The flow is deliberately two-step: VALIDATE, then COMMIT. HR never uploads
 * straight into the database.
 *
 * And it is all-or-nothing. Importing the good rows while reporting the bad ones
 * sounds friendlier and is a trap: Priya fixes three rows, re-uploads the whole
 * file, and now gets 197 "duplicate code" errors with no idea which rows landed
 * the first time. A half-imported payroll master is worse than none.
 */
export function ImportEmployees() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const qc = useQueryClient();

  const validate = useMutation({
    mutationFn: (f: File) => api.upload<ImportReport>('/employees/import?dryRun=true', f),
    onSuccess: setReport,
  });

  const commit = useMutation({
    mutationFn: (f: File) => api.upload<ImportReport>('/employees/import', f),
    onSuccess: (result) => {
      setReport(result);
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });

  function pick(selected: File | null) {
    setFile(selected);
    setReport(null);
    if (selected) validate.mutate(selected);
  }

  const canCommit = report && report.errors.length === 0 && report.valid > 0 && !report.imported;
  const done = report && report.imported > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import employees</h1>
        <p className="text-sm text-muted-foreground">
          Bring your existing team in from a spreadsheet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Start from the template</CardTitle>
          <CardDescription>
            It includes a “Read Me” sheet explaining the two PF columns — those are the ones that
            decide whether Provident Fund is deducted at all, and they are easy to get wrong.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() =>
              api.download('/employees/import/template', 'peoplepulse-employee-import.xlsx')
            }
          >
            <Download className="h-4 w-4" />
            Download template
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Upload the filled file</CardTitle>
          <CardDescription>
            We check every row first. Nothing is saved until you confirm.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-8 transition-colors hover:border-primary/50 hover:bg-accent/40">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm font-medium">
              {file ? file.name : 'Choose an .xlsx file'}
            </span>
            <span className="text-xs text-muted-foreground">or drag it here</span>
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
          </label>

          {validate.isPending && (
            <p className="text-sm text-muted-foreground">Checking your file…</p>
          )}
        </CardContent>
      </Card>

      {/* ---------------- The validation report ---------------- */}
      {report && report.errors.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {report.errors.length} {report.errors.length === 1 ? 'problem' : 'problems'} found —
              nothing was imported
            </CardTitle>
            <CardDescription>
              Fix these in your spreadsheet and upload it again. We import all rows or none, so your
              data is never left half-loaded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Row</th>
                    <th className="px-3 py-2 text-left">Column</th>
                    <th className="px-3 py-2 text-left">Value</th>
                    <th className="px-3 py-2 text-left">What’s wrong</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map((e, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="tabular px-3 py-2 font-medium">{e.row}</td>
                      <td className="px-3 py-2 text-muted-foreground">{e.column}</td>
                      <td className="tabular px-3 py-2 text-xs">{e.value || '(empty)'}</td>
                      <td className="px-3 py-2">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Ready to commit ---------------- */}
      {canCommit && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-status-member" />
              {report.valid} {report.valid === 1 ? 'row is' : 'rows are'} ready to import
            </CardTitle>
            <CardDescription>
              Every row checked out. Provident Fund status will be worked out for each person from
              their joining wage and whether they already had a PF account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => file && commit.mutate(file)} disabled={commit.isPending}>
              <Upload className="h-4 w-4" />
              {commit.isPending ? 'Importing…' : `Import ${report.valid} employees`}
            </Button>
          </CardContent>
        </Card>
      )}

      {done && (
        <Card className="border-status-member/40 bg-status-member/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <CheckCircle2 className="h-5 w-5 text-status-member" />
            <div>
              <p className="font-medium">Imported {report.imported} employees.</p>
              <Link to="/employees" className="text-sm text-primary hover:underline">
                View them →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
