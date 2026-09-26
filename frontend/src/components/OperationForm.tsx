import { type FormEvent, useId } from 'react';
import type { Field, FormValues, Line, Operation } from '../operations.ts';

interface Props {
  operation: Operation;
  values: FormValues;
  running: boolean;
  onChange(values: FormValues): void;
  onRun(): void;
  onReset(): void;
}

const inputClass =
  'w-full rounded-lg bg-slate-950/70 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700 transition ' +
  'placeholder:text-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-none';

export function OperationForm({ operation, values, running, onChange, onRun, onReset }: Props) {
  const set = (name: string, value: string | Line[]) => onChange({ ...values, [name]: value });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRun();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {operation.fields.map((field) =>
          field.type === 'lines' ? (
            <LinesField
              key={field.name}
              field={field}
              lines={values[field.name] as Line[]}
              onChange={(lines) => set(field.name, lines)}
            />
          ) : (
            <InputField
              key={field.name}
              field={field}
              value={values[field.name] as string}
              onChange={(value) => set(field.name, value)}
            />
          ),
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-70"
        >
          {running ? (
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden="true">
              <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.34-5.89a1.5 1.5 0 0 0 0-2.54L6.3 2.84Z" />
            </svg>
          )}
          {running ? 'Running…' : 'Run'}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          Reset
        </button>
      </div>
    </form>
  );
}

/** Label names the input; the hint is its description (not part of the name). */
function InputField({ field, value, onChange }: { field: Field; value: string; onChange(value: string): void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-300">
        {field.label}
      </label>
      <input
        id={id}
        className={inputClass}
        name={field.name}
        type={field.type === 'date' ? 'date' : 'number'}
        inputMode={field.type === 'integer' ? 'numeric' : undefined}
        value={value}
        aria-describedby={field.hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {field.hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {field.hint}
        </p>
      )}
    </div>
  );
}

function LinesField({ field, lines, onChange }: { field: Field; lines: Line[]; onChange(lines: Line[]): void }) {
  const update = (index: number, change: Partial<Line>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...change } : line)));

  return (
    <fieldset className="sm:col-span-2 xl:col-span-3">
      <legend className="mb-1.5 text-xs font-medium text-slate-300">{field.label}</legend>
      <div className="mb-1 flex gap-2 pr-10 text-[11px] font-medium tracking-wide text-slate-500 uppercase" aria-hidden="true">
        <span className="flex-1">Product ID</span>
        <span className="flex-1">Quantity</span>
      </div>
      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              className={inputClass}
              aria-label={`Line ${index + 1} product ID`}
              placeholder="Product ID"
              type="number"
              value={line.productId}
              onChange={(event) => update(index, { productId: event.target.value })}
            />
            <input
              className={inputClass}
              aria-label={`Line ${index + 1} quantity`}
              placeholder="Quantity"
              type="number"
              value={line.quantity}
              onChange={(event) => update(index, { quantity: event.target.value })}
            />
            <button
              type="button"
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
              aria-label={`Remove line ${index + 1}`}
              className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...lines, { productId: '', quantity: '1' }])}
        className="mt-2 text-xs font-medium text-sky-300 transition hover:text-sky-200"
      >
        + Add line
      </button>
      {field.hint && <p className="mt-1 text-xs text-slate-500">{field.hint}</p>}
    </fieldset>
  );
}
