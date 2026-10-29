// Decorative route map: shipping lanes arcing into Tema.
const routes = [
  "M60 120 Q 220 40 330 250",
  "M80 330 Q 180 380 330 250",
  "M560 90 Q 470 120 330 250",
  "M600 300 Q 470 330 330 250",
  "M420 40 Q 380 140 330 250",
];

export function HeroRoutes() {
  return (
    <svg className="hero-routes" viewBox="0 0 660 420" aria-hidden="true">
      <defs>
        <pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.3" fill="currentColor" opacity="0.18" />
        </pattern>
      </defs>
      <rect width="660" height="420" fill="url(#dots)" rx="28" />
      {routes.map((d, index) => (
        <g key={d}>
          <path d={d} className="route-base" />
          <path
            d={d}
            className="route-flow"
            style={{ animationDelay: `${index * 0.6}s` }}
          />
        </g>
      ))}
      {[
        [60, 120],
        [80, 330],
        [560, 90],
        [600, 300],
        [420, 40],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="5" className="route-node" />
      ))}
      <circle cx="330" cy="250" r="22" className="hub-pulse" />
      <circle cx="330" cy="250" r="9" className="hub" />
      <text x="348" y="284" className="hub-label">
        Tema, Ghana
      </text>
    </svg>
  );
}
