import React, { cloneElement, isValidElement, useState } from 'react'
import styles from './style.module.css'
import Overlay from '../overlay'

interface ActionBarProps {
  actions?: ActionOptions
}

export type ActionOptions = Array<ActionOption>

export interface ActionOption {
  name: string
  icon: React.ReactNode
  onSelect: () => void
}

export const ActionBar: React.FC<ActionBarProps> = ({ actions }) => {
  const [activeIndex, setActiveIndex] = useState<number>(0)

  const handleClick = (index: number, onSelect: () => void) => {
    if (activeIndex === index) return
    setActiveIndex(index)
    onSelect()
  }

  return (
    <Overlay>
      <div className={styles.bar}>
        {(actions ?? []).map((action, index) => (
          <ActionButton
            key={index}
            icon={action.icon}
            name={action.name}
            active={index === activeIndex}
            onClick={() => handleClick(index, action.onSelect)}
          />
        ))}
      </div>
    </Overlay>
  )
}

interface ButtonProps {
  icon: React.ReactNode
  name: string
  active?: boolean
  onClick?: () => void
}

export const ActionButton: React.FC<ButtonProps> = ({ icon, name, onClick, active }) => {
  return (
    <div className={`${styles.button}${active ? ` ${styles.active}` : ''}`} onClick={() => onClick?.()}>
      <div className={styles.corners}>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
      </div>
      <div className={styles.bubble}>
        <div className={styles.name}>{name}</div>
      </div>
      <div className={styles.icon}>{icon}</div>
    </div>
  )
}
