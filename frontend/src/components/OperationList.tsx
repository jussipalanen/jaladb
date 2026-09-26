import type { Operation } from '../operations.ts';

interface Props {
  operations: Operation[];
  selectedId: string;
  onSelect(id: string): void;
}

export function OperationList({ operations, selectedId, onSelect }: Props) {
  return (
    <nav aria-label="Operations">
      <p className="mb-3 px-3 text-xs font-semibold tracking-wider text-blue-300/70 uppercase">Operations</p>
      <ul className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
        {operations.map((operation) => {
          const selected = operation.id === selectedId;
          return (
            <li key={operation.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(operation.id)}
                aria-current={selected ? 'page' : undefined}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                  selected
                    ? 'bg-blue-600/20 text-white ring-1 ring-blue-500/50'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                }`}
              >
                <span className="block text-sm font-medium">{operation.title}</span>
                <span className="block font-mono text-[11px] text-blue-300/70">{operation.dbFunction}()</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
