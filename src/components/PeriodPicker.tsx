'use client';
import { useMemo } from 'react';
import { CalendarDays, LockKeyhole, TriangleAlert } from 'lucide-react';
import { buildPeriod, daysInPeriod, monthLabelShort, periodPresets, MAX_PERIOD_MONTHS } from '@/lib/period';

export default function PeriodPicker({
  from,
  to,
  today,
  onChange,
  label = 'Reporting Period',
  months,
  closedMonths = [],
  showCoverage = true,
}: {
  from: string;
  to: string;
  today: string;
  onChange: (next: { from: string; to: string }) => void;
  label?: string;
  months?: string[];
  closedMonths?: string[];
  showCoverage?: boolean;
}) {
  const presets = useMemo(() => periodPresets(today), [today]);
  const period = useMemo(() => buildPeriod(from, to), [from, to]);
  const invalid = !period;
  const covered = months && months.length ? months : period?.months;
  const activePreset = presets.find((p) => p.from === from && p.to === to);
  const trimmed = Boolean(from || to);

  return (
    <div className="period-picker">
      <div className="period-picker-head">
        <span className="period-picker-label">
          <CalendarDays size={14} /> {label}
        </span>
        {showCoverage && period && (
          <span className="period-picker-summary">
            {period.months.length} month{period.months.length === 1 ? '' : 's'} · {daysInPeriod(period)} day{daysInPeriod(period) === 1 ? '' : 's'}
          </span>
        )}
        {trimmed && (
          <button type="button" className="btn outline" onClick={() => onChange({ from: '', to: '' })}>
            Clear
          </button>
        )}
      </div>

      <div className="period-presets">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`period-preset${activePreset?.id === preset.id ? ' active' : ''}`}
            onClick={() => onChange({ from: preset.from, to: preset.to })}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="period-inputs">
        <label>
          From
          <input type="date" value={from} onChange={(e) => onChange({ from: e.target.value, to })} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => onChange({ from, to: e.target.value })} />
        </label>
      </div>

      {invalid ? (
        <p className="period-hint error">
          <TriangleAlert size={13} /> Choose a valid period of up to {MAX_PERIOD_MONTHS} months where the start is not after the end.
        </p>
      ) : (
        covered && (
          <div className="period-months">
            {covered.map((month) => (
              <span key={month} className={`period-month${closedMonths.includes(month) ? ' locked' : ''}`}>
                {monthLabelShort(month)}
                {closedMonths.includes(month) && <LockKeyhole size={11} />}
              </span>
            ))}
          </div>
        )
      )}
    </div>
  );
}
