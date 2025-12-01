interface ChartDatum {
  label: string;
  value: number;
}

interface ChartViewProps {
  title?: string;
  data: ChartDatum[];
  type?: 'bar' | 'line';
}

export default function ChartView({ title, data, type = 'bar' }: ChartViewProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const width = 520;
  const height = 220;
  const padding = 32;
  const barWidth = Math.max(12, (width - padding * 2) / Math.max(data.length, 1) - 8);

  const points = data.map((d, idx) => {
    const x = padding + idx * ((width - padding * 2) / Math.max(data.length - 1, 1));
    const y = padding + (1 - d.value / max) * (height - padding * 2);
    return { ...d, x, y };
  });

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-200">
        <span>{title ?? 'Chart view'}</span>
        <span className="text-xs text-slate-400">{data.length} items</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.4" />
          </linearGradient>
        </defs>
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          rx={12}
          className="fill-slate-900/40 stroke-slate-800"
        />
        {type === 'bar' &&
          points.map((p, idx) => (
            <g key={idx}>
              <rect
                x={padding + idx * ((width - padding * 2) / Math.max(data.length, 1))}
                y={padding + (1 - p.value / max) * (height - padding * 2)}
                width={barWidth}
                height={(p.value / max) * (height - padding * 2)}
                fill="url(#chartFill)"
                rx={6}
              />
              <text
                x={padding + idx * ((width - padding * 2) / Math.max(data.length, 1)) + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                className="text-[10px] fill-slate-400"
              >
                {p.label}
              </text>
            </g>
          ))}
        {type === 'line' && (
          <>
            <polyline
              fill="none"
              stroke="#22d3ee"
              strokeWidth={2}
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
            />
            {points.map((p, idx) => (
              <g key={idx}>
                <circle cx={p.x} cy={p.y} r={4} fill="#0ea5e9" />
                <text x={p.x} y={height - 6} textAnchor="middle" className="text-[10px] fill-slate-400">
                  {p.label}
                </text>
              </g>
            ))}
          </>
        )}
      </svg>
    </div>
  );
}
