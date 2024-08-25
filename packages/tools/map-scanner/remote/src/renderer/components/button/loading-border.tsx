import * as React from 'react'
import styles from './style.module.css'
const LoadingBorder = () => (
  <svg className={styles['loading-border']} xmlns="http://www.w3.org/2000/svg">
    <rect
      width="100%"
      height="100%"
      fill="none"
      rx="50%"
      ry="50%"
      stroke="#585858"
      strokeWidth={2}
      strokeDasharray="25.71%, 25.71%"
      strokeLinecap="square"
    />
  </svg>
)
export default LoadingBorder
