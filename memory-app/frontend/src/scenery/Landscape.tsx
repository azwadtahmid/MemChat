// The ink landscape in the content field: misty ridges, still water and a pine
// outcrop in pale wash on the paper, with bands of cloud drifting between and
// in front of the ridges. Decoration only: aria-hidden and pointer-events
// none. All motion is CSS ("Scenery" in styles.css). It spans the field behind
// the heading and search, faint, and dissolves into the paper before the
// notes begin.

import { BAND, TILE, farEdge, farFill, midEdge, midFill, nearEdge, nearFill, pines, rock, rockEdge, water } from './paths'

function Layer({ name, fill, edge, children }: { name: string; fill?: string; edge?: string; children?: React.ReactNode }) {
  return (
    <div className={`ink-layer ink-${name}`}>
      <svg viewBox={`0 0 ${TILE * 2} ${BAND}`} focusable="false">
        {fill && <path className="wash" d={fill} />}
        {edge && <path className="edge" d={edge} />}
        {children}
      </svg>
    </div>
  )
}

// Each band is a loose run of overlapping ellipses (cx, cy, rx, ry) on a
// 400 x 60 sheet, blurred so no band has an outline.
const CLOUDS: [number, number, number, number][][] = [
  [[70, 32, 62, 9], [150, 28, 74, 12], [238, 31, 66, 10], [318, 33, 58, 8]],
  [[60, 30, 52, 11], [128, 34, 60, 9], [206, 28, 82, 13], [300, 32, 64, 10], [352, 30, 36, 7]],
  [[82, 31, 70, 10], [176, 29, 64, 13], [262, 33, 78, 9], [334, 30, 44, 8]],
  [[52, 33, 44, 8], [120, 29, 70, 12], [214, 32, 72, 10], [296, 29, 60, 12], [356, 32, 30, 6]],
]

/** A band of cloud drifting across its own lane, faded out before either edge. */
function Cloud({ n }: { n: number }) {
  return (
    <div className={`cloud-lane cloud-${n + 1}`}>
      <svg className="cloud" viewBox="0 0 400 60" preserveAspectRatio="none" focusable="false">
        <defs>
          <filter id={`cloud-blur-${n}`} x="-20%" y="-80%" width="140%" height="260%">
            <feGaussianBlur stdDeviation="7 5" />
          </filter>
        </defs>
        <g filter={`url(#cloud-blur-${n})`}>
          {CLOUDS[n].map(([cx, cy, rx, ry]) => (
            <ellipse key={cx} cx={cx} cy={cy} rx={rx} ry={ry} />
          ))}
        </g>
      </svg>
    </div>
  )
}

export default function Scenery() {
  return (
    <div className="scenery" aria-hidden="true">
      <div className="ink-layers">
        <Cloud n={0} />
        <Layer name="far" fill={farFill} edge={farEdge} />
        <Cloud n={1} />
        <Layer name="mid" fill={midFill} edge={midEdge} />
        <Cloud n={2} />
        <Layer name="near" fill={nearFill} edge={nearEdge} />
        <Layer name="water">
          <path className="edge" d={water} />
          <path className="edge" d={water} transform={`translate(${TILE} 0)`} />
        </Layer>
      </div>
      <svg className="outcrop" viewBox="0 0 280 172" focusable="false">
        <path className="wash" d={rock} />
        <path className="edge" d={rockEdge} />
        <path className="edge" d={pines} />
      </svg>
      {/* The nearest band passes in front of the ridges and the outcrop. */}
      <div className="cloud-front">
        <Cloud n={3} />
      </div>
    </div>
  )
}
