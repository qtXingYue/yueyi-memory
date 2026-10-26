/** 极简克制的 14 天活动趋势图（单色调自适应容器宽度，无炫光） */
export function Spark({
  data,
  height = 40,
}: {
  data: number[];
  height?: number;
}) {
  const d = data.length ? data : new Array(14).fill(0);
  const max = Math.max(1, ...d);
  const n = d.length;
  const viewW = 236;
  const gap = 5;
  const barW = Math.max(6, (viewW - gap * (n - 1)) / n);

  return (
    <svg
      viewBox={`0 0 ${viewW} ${height}`}
      className="block h-10 w-full overflow-visible"
      preserveAspectRatio="none"
    >
      <line
        x1="0"
        y1={height - 0.5}
        x2={viewW}
        y2={height - 0.5}
        stroke="rgba(var(--c-accent-rgb), 0.16)"
        strokeWidth="1"
      />
      {d.map((v, i) => {
        const active = v > 0;
        const h = active ? Math.max(10, (v / max) * (height - 6)) : 4;
        const x = i * (barW + gap);
        const y = height - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={Math.min(3, barW / 2)}
            fill={
              active
                ? "rgb(var(--c-accent))"
                : "rgba(var(--c-accent-rgb), 0.18)"
            }
          />
        );
      })}
    </svg>
  );
}
