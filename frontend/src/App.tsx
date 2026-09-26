import { useState } from 'react';
import { type ApiResponse, callApi } from './api.ts';
import { HealthBadge } from './components/HealthBadge.tsx';
import { OperationForm } from './components/OperationForm.tsx';
import { OperationList } from './components/OperationList.tsx';
import { ResultPanel } from './components/ResultPanel.tsx';
import { type FormValues, initialValues, operations } from './operations.ts';

export function App() {
  const [selectedId, setSelectedId] = useState(operations[0]!.id);
  const [valuesById, setValuesById] = useState<Record<string, FormValues>>(() =>
    Object.fromEntries(operations.map((op) => [op.id, initialValues(op)])),
  );
  const [responses, setResponses] = useState<Record<string, ApiResponse>>({});
  const [running, setRunning] = useState(false);

  const operation = operations.find((op) => op.id === selectedId)!;
  const values = valuesById[operation.id]!;
  const response = responses[operation.id];

  const run = async () => {
    setRunning(true);
    const request = operation.toRequest(values);
    const result = await callApi(request.method, request.path, request.body);
    setResponses((current) => ({ ...current, [operation.id]: result }));
    setRunning(false);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-800 shadow-lg shadow-blue-900/50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6 text-blue-50" aria-hidden="true">
              <ellipse cx="12" cy="6" rx="7" ry="2.8" />
              <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">JalaDB Console</h1>
            <p className="text-xs text-slate-400">Run PostgreSQL functions through the API</p>
          </div>
        </div>
        <HealthBadge />
      </header>

      <div className="grid flex-1 gap-6 lg:grid-cols-[15rem_1fr]">
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <OperationList operations={operations} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>

        <main className="min-w-0 space-y-6">
          <section className="rounded-2xl bg-slate-900/60 p-6 shadow-xl shadow-black/20 ring-1 ring-blue-900/50 backdrop-blur">
            <div className="mb-5">
              <h2 className="text-xl font-semibold text-white">{operation.title}</h2>
              <p className="mt-1 text-sm text-slate-400">{operation.description}</p>
              <code className="mt-3 inline-block rounded-lg bg-slate-950/80 px-3 py-1.5 font-mono text-xs text-sky-300 ring-1 ring-blue-900/50">
                {operation.sql}
              </code>
            </div>
            <OperationForm
              operation={operation}
              values={values}
              running={running}
              onChange={(next) => setValuesById((current) => ({ ...current, [operation.id]: next }))}
              onRun={run}
              onReset={() => setValuesById((current) => ({ ...current, [operation.id]: initialValues(operation) }))}
            />
          </section>

          <section className="rounded-2xl bg-slate-900/60 p-6 shadow-xl shadow-black/20 ring-1 ring-blue-900/50 backdrop-blur">
            <h2 className="mb-4 text-sm font-semibold tracking-wider text-blue-300/80 uppercase">Result</h2>
            {response ? (
              <ResultPanel operation={operation} response={response} />
            ) : (
              <p className="py-8 text-center text-sm text-slate-500">
                Press <span className="font-medium text-slate-300">Run</span> to call{' '}
                <code className="font-mono text-sky-300">{operation.dbFunction}()</code>.
              </p>
            )}
          </section>
        </main>
      </div>

      <footer className="mt-10 text-center text-xs text-slate-600">
        Predefined operations only · the console never sends SQL
      </footer>
    </div>
  );
}
