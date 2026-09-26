import type { ReactNode } from 'react';
import { type ApiResponse, apiError } from '../api.ts';
import { columnLabel, formatCell, isNumeric } from '../format.ts';
import type { Cell, Operation, ResultView } from '../operations.ts';

interface Props {
  operation: Operation;
  response: ApiResponse;
}

function statusStyle(status: number): string {
  if (status >= 200 && status < 300) return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
  if (status === 409) return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
  if (status >= 400 && status < 500) return 'bg-orange-500/15 text-orange-300 ring-orange-500/30';
  return 'bg-rose-500/15 text-rose-300 ring-rose-500/30';
}

export function ResultPanel({ operation, response }: Props) {
  const error = apiError(response);
  const view = error ? undefined : operation.toView(response.data);
  const rowCount = view?.kind === 'table' ? view.rows.length : view ? 1 : 0;

  return (
    <section aria-label="Result" className="space-y-4">
      <dl className="flex flex-wrap items-center gap-2 text-xs">
        <Meta label="Status">
          <span className={`rounded-md px-2 py-0.5 font-semibold ring-1 ${statusStyle(response.status)}`}>
            {response.status === 0 ? 'No response' : response.status}
          </span>
        </Meta>
        <Meta label="Time">
          <span className="font-mono text-slate-100">{response.durationMs.toFixed(1)} ms</span>
        </Meta>
        {view && (
          <Meta label="Rows">
            <span className="font-mono text-slate-100">{rowCount}</span>
          </Meta>
        )}
        <Meta label="Request">
          <span className="font-mono text-slate-300">
            {response.method} {decodeURIComponent(response.path)}
          </span>
        </Meta>
      </dl>

      {error ? (
        <div role="alert" className="rounded-xl bg-rose-950/40 p-4 ring-1 ring-rose-500/30">
          <p className="flex flex-wrap items-center gap-2 font-mono text-sm font-semibold text-rose-200">
            {error.code}
            {error.sqlstate && (
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-xs font-medium text-rose-200">
                SQLSTATE {error.sqlstate}
              </span>
            )}
          </p>
          <p className="mt-1.5 text-sm text-rose-100/90">{error.message}</p>
        </div>
      ) : (
        view && <ResultData view={view} />
      )}

      {response.body !== undefined && (
        <details className="group rounded-xl bg-slate-950/50 ring-1 ring-slate-800">
          <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200">
            Request body
          </summary>
          <pre className="overflow-x-auto px-4 pb-3 font-mono text-xs text-sky-200">
            {JSON.stringify(response.body, null, 2)}
          </pre>
        </details>
      )}
      <details className="group rounded-xl bg-slate-950/50 ring-1 ring-slate-800">
        <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200">
          Raw response
        </summary>
        <pre className="overflow-x-auto px-4 pb-3 font-mono text-xs text-sky-200">
          {JSON.stringify(response.data, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-2.5 py-1.5 ring-1 ring-slate-800">
      <dt className="text-slate-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ResultData({ view }: { view: ResultView }) {
  if (view.kind === 'record') {
    return (
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(view.fields).map(([key, value]) => (
          <div key={key} className="rounded-xl bg-slate-950/60 p-4 ring-1 ring-blue-900/40">
            <dt className="text-xs text-slate-400">{columnLabel(key)}</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-white tabular-nums">{formatCell(value)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (view.rows.length === 0) {
    return (
      <p className="rounded-xl bg-slate-950/50 p-6 text-center text-sm text-slate-400 ring-1 ring-slate-800">
        No rows returned.
      </p>
    );
  }

  const numeric = (column: string) => view.rows.every((row) => isNumeric(row[column] ?? null));
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-900/90 text-xs text-slate-400">
          <tr>
            {view.columns.map((column) => (
              <th key={column} scope="col" className={`px-4 py-2.5 font-medium ${numeric(column) ? 'text-right' : ''}`}>
                {columnLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80 bg-slate-950/40">
          {view.rows.map((row, index) => (
            <tr key={index} className="transition hover:bg-blue-950/40">
              {view.columns.map((column) => (
                <td
                  key={column}
                  className={`px-4 py-2.5 whitespace-nowrap ${
                    numeric(column) ? 'text-right font-mono tabular-nums text-slate-100' : 'text-slate-200'
                  }`}
                >
                  {formatCell((row[column] ?? null) as Cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
