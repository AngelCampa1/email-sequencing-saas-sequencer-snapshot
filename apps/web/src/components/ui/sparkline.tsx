import type { SVGProps } from 'react'

export function buildSparklinePoints(values: number[], width: number, height: number): string {
  if (values.length < 2) return ''

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min

  return values
    .map((v, i) => {
      const x = parseFloat(((i / (values.length - 1)) * width).toFixed(2))
      const y =
        range === 0
          ? parseFloat((height / 2).toFixed(2))
          : parseFloat((((max - v) / range) * height).toFixed(2))
      return `${x},${y}`
    })
    .join(' ')
}

// Omit SVG's built-in `values` (a string attr) so our numeric series prop
// doesn't conflict with the inherited DOM typing.
interface SparklineProps extends Omit<SVGProps<SVGSVGElement>, 'values'> {
  values: number[]
  width?: number
  height?: number
  strokeClassName?: string
  'aria-label'?: string
}

export function Sparkline({
  values,
  width = 80,
  height = 20,
  className = '',
  strokeClassName = 'text-blue-500',
  'aria-label': ariaLabel,
  ...svgProps
}: SparklineProps) {
  const points = buildSparklinePoints(values, width, height)

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      className={className}
      {...svgProps}
    >
      {points !== '' && (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={strokeClassName}
        />
      )}
    </svg>
  )
}
