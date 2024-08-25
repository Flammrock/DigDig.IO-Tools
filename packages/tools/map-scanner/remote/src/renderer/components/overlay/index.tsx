import React from 'react'
import styles from './style.module.css'

const Overlay: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return <div className={styles.overlay}>{children}</div>
}

export default Overlay
