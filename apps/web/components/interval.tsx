import { pct } from "../lib/format";

/** Score with its 95% Wilson interval drawn as an error bar on a 0 to 100% track. */
export function Interval({
  score,
  low,
  high,
  bare = false,
}: {
  score: number;
  low: number;
  high: number;
  /** Draw only the bar, for tables that show the numbers in their own columns. */
  bare?: boolean;
}) {
  return (
    <span className="interval" title={`95% CI ${pct(low)} to ${pct(high)}`}>
      <span className="track">
        <span
          className="range"
          style={{
            left: `${low / 100}%`,
            width: `${Math.max(0, high - low) / 100}%`,
          }}
        />
        <span className="point" style={{ left: `${score / 100}%` }} />
      </span>
      {!bare && (
        <span className="mono">
          {pct(score)}{" "}
          <span className="muted">
            [{pct(low)}, {pct(high)}]
          </span>
        </span>
      )}
    </span>
  );
}
