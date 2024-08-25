import * as React from 'react'
import styles from './style.module.css'
const RainbowBorder = () => (
  <svg className={styles['rainbow-border']}>
    <defs>
      <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop
          offset="0%"
          style={{
            stopColor: 'gold',
            stopOpacity: 1
          }}
        />
        <stop
          offset="100%"
          style={{
            stopColor: 'deeppink',
            stopOpacity: 1
          }}
        />
      </linearGradient>
    </defs>
    <rect x={0} y={0} width="100%" height="100%" rx={20} ry={20} fill="none" stroke="url(#grad1)" strokeWidth={2} />
  </svg>
)
export default RainbowBorder
