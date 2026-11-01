import type { CSSProperties, ReactNode } from "react";
import styles from "./charts.module.css";

/** One blue for the main thing, status colours only for payment state (Evans, 2026-10-04). */
export const chartColors = {
  blue: "#0b3fae",
  blueMid: "#3a6fd8",
  blueLight: "#8fb0ee",
  other: "#c5cedb",
  cost: "#8aa0b8",
  good: "#16a34a",
  warning: "#f2a900",
  bad: "#dc2626",
} as const;

export type DonutSegment = {
  label: string;
  value: number;
  /** The figure as it should read, such as "GHS 105.00" or "3". */
  display: string;
  color: string;
};

/**
 * A ring with the headline figure in the middle. Every part is also listed with its
 * figure and share, so nothing depends on telling colours apart.
 */
export function DonutChart({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter((segment) => segment.value > 0);
  // A gap the width of the page background keeps neighbouring arcs apart.
  const gap = visible.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className={styles.donutWrap}>
      <svg
        aria-label={`${centerLabel}: ${centerValue}. ${segments
          .map((segment) => `${segment.label} ${segment.display}`)
          .join(", ")}`}
        className={styles.donut}
        role="img"
        viewBox="0 0 140 140"
      >
        <circle
          className={styles.donutTrack}
          cx="70"
          cy="70"
          fill="none"
          r={radius}
          strokeWidth="20"
        />
        {total > 0 &&
          visible.map((segment, index) => {
            const length = (segment.value / total) * circumference;
            const arc = (
              <circle
                className={styles.donutArc}
                cx="70"
                cy="70"
                fill="none"
                key={`${index}-${segment.label}`}
                r={radius}
                stroke={segment.color}
                strokeDasharray={`${Math.max(length - gap, 0.5)} ${circumference}`}
                strokeDashoffset={-offset}
                strokeWidth="20"
                transform="rotate(-90 70 70)"
              >
                <title>{`${segment.label}: ${segment.display}`}</title>
              </circle>
            );
            offset += length;
            return arc;
          })}
        <text className={styles.donutValue} textAnchor="middle" x="70" y="72">
          {centerValue}
        </text>
        <text className={styles.donutLabel} textAnchor="middle" x="70" y="90">
          {centerLabel}
        </text>
      </svg>
      <ul className={styles.donutLegend}>
        {segments.map((segment, index) => (
          <li key={`${index}-${segment.label}`}>
            <span
              aria-hidden="true"
              className={styles.swatch}
              style={{ background: segment.color }}
            />
            <span className={styles.legendName}>{segment.label}</span>
            <strong>{segment.display}</strong>
            <span className={styles.legendShare}>
              {total > 0
                ? `${Math.round((segment.value / total) * 100)}%`
                : "0%"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type BarRow = {
  key: string;
  label: ReactNode;
  /** Bar length, always positive. */
  value: number;
  display: string;
  color: string;
};

/** Ranked horizontal bars: the name and figure above, one bar below, longest first. */
export function RankedBars({ rows }: { rows: BarRow[] }) {
  const longest = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className={styles.bars}>
      {rows.map((row) => (
        <li key={row.key}>
          <div className={styles.barHead}>
            <span className={styles.barLabel}>{row.label}</span>
            <strong>{row.display}</strong>
          </div>
          <div className={styles.barTrack}>
            <div
              className={styles.barFill}
              style={{
                width: `${row.value > 0 ? Math.max(2, (row.value / longest) * 100) : 0}%`,
                background: row.color,
              }}
              title={row.display}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export type ColumnSeries = { name: string; color: string; values: number[] };

/** The next round number at or above the value (1, 2, 2.5, 5 or 10 times a power of ten). */
function roundUp(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(
    (candidate) => candidate * power >= value,
  );
  return (step ?? 10) * power;
}

/**
 * Side-by-side columns per period (one pair per month), on one scale starting at
 * zero. The same figures are in a table for screen readers, and each column
 * carries its figure as a tooltip.
 */
export function ColumnChart({
  periods,
  series,
  format,
  axisFormat = format,
}: {
  /** One entry per period: a short label for the axis and a full one for tooltips. */
  periods: Array<{ short: string; full: string }>;
  series: ColumnSeries[];
  format: (value: number) => string;
  /** A shorter form for the scale on the left. */
  axisFormat?: (value: number) => string;
}) {
  const top = roundUp(Math.max(0, ...series.flatMap((entry) => entry.values)));
  return (
    <div>
      <div className={styles.columns} aria-hidden="true">
        <div className={styles.yAxis}>
          <span>{axisFormat(top)}</span>
          <span>{axisFormat(top / 2)}</span>
          <span>{axisFormat(0)}</span>
        </div>
        <div
          className={styles.plot}
          style={{ "--periods": periods.length } as CSSProperties}
        >
          <div className={styles.lines} />
          {periods.map((period, index) => (
            <div className={styles.group} key={period.full}>
              <div className={styles.pair}>
                {series.map((entry) => (
                  <div
                    className={styles.column}
                    key={entry.name}
                    style={{
                      height: `${(entry.values[index] / top) * 100}%`,
                      background: entry.color,
                    }}
                    title={`${entry.name}, ${period.full}: ${format(entry.values[index])}`}
                  />
                ))}
              </div>
              <span className={styles.groupLabel}>{period.short}</span>
            </div>
          ))}
        </div>
      </div>
      <ul className={styles.columnLegend}>
        {series.map((entry) => (
          <li key={entry.name}>
            <span
              aria-hidden="true"
              className={styles.swatch}
              style={{ background: entry.color }}
            />
            {entry.name}
          </li>
        ))}
      </ul>
      <div className={styles.srOnly}>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {series.map((entry) => (
                <th key={entry.name} scope="col">
                  {entry.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period, index) => (
              <tr key={period.full}>
                <th scope="row">{period.full}</th>
                {series.map((entry) => (
                  <td key={entry.name}>{format(entry.values[index])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
