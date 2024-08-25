import React from 'react'
import styles from './style.module.css'
import Overlay from '../overlay'

interface MenuProps {
  children?: React.ReactNode
}

const Menu: React.FC<MenuProps> = ({ children }) => {
  return (
    <Overlay>
      <div className={styles.menu}>{children}</div>
    </Overlay>
  )
}

export default Menu
