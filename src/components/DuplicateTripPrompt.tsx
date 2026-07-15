"use client";

export interface DuplicateTrip {
  id: string;
  name: string;
  createdAt: string;
  locationCount: number;
}

/**
 * Shared with both trip-creation entry points (blank New Trip and My Maps import, #119 follow-up):
 * a name collision is caught server-side by `checkTripNameCollision` and handed back as this shape,
 * and either form can resolve it the same two ways — rename-and-create, or replace the existing
 * trip outright.
 */
export function DuplicateTripPrompt({
  existingTrips,
  renameValue,
  onRenameChange,
  confirmLabel,
  onConfirmRenamed,
  onOverwrite,
  onCancel,
  loading,
}: {
  existingTrips: DuplicateTrip[];
  renameValue: string;
  onRenameChange: (v: string) => void;
  confirmLabel: string;
  onConfirmRenamed: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-3 border border-line-strong rounded-lg p-3 bg-surface-2">
      <p className="text-sm text-ink font-medium">A trip named this already exists</p>
      <ul className="text-xs text-sub space-y-0.5">
        {existingTrips.map((t) => (
          <li key={t.id}>
            <strong className="text-ink">{t.name}</strong> · {t.locationCount} location{t.locationCount !== 1 ? "s" : ""} · created {new Date(t.createdAt).toLocaleDateString()}
          </li>
        ))}
      </ul>

      <div className="space-y-1.5">
        <label htmlFor="dup-rename" className="text-xs text-faint">Create as a new trip named</label>
        <div className="flex gap-2">
          <input
            id="dup-rename"
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            className="input text-sm flex-1"
          />
          <button type="button" onClick={onConfirmRenamed} disabled={loading || !renameValue.trim()} className="btn-primary text-sm px-3 disabled:opacity-40">
            {confirmLabel}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-faint">
        <span className="flex-1 border-t border-line-strong" />or<span className="flex-1 border-t border-line-strong" />
      </div>

      <button type="button" onClick={onOverwrite} disabled={loading} className="btn-secondary text-sm w-full disabled:opacity-40">
        Replace &ldquo;{existingTrips[0].name}&rdquo; with this one
      </button>

      <button type="button" onClick={onCancel} className="text-xs text-faint hover:text-ink underline underline-offset-2 w-full text-center">
        Cancel
      </button>
    </div>
  );
}
