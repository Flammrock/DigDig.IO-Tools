import React, { useCallback, useMemo, useRef, useState } from 'react'
import styles from './style.module.css'
import { Nullable } from 'shared'
import RainbowBorder from './rainbow-border'
import LoadingBorder from './loading-border'

interface ButtonProps {
  icon: React.ReactNode
  name: string
  state?: ButtonState
  onClick?: () => Promise<ButtonFeedback | void | undefined>
}

export enum ButtonState {
  Normal,
  Loading,
  // Active,
  Disabled,
  Success,
  Error
}

export enum ButtonFeedback {
  Nothing,
  Success,
  Error
}

const Button: React.FC<ButtonProps> = ({ icon, name, state, onClick }) => {
  const [isHovered, setIsHovered] = useState(false)
  const [currentState, setCurrentState] = useState(state ?? ButtonState.Normal)
  const timeoutRef = useRef<Nullable<number>>(null)

  const classNameState = useMemo(() => {
    switch (currentState) {
      // case ButtonState.Active:
      //  return 'active'
      case ButtonState.Disabled:
        return 'disabled'
      case ButtonState.Loading:
        return 'loading'
      case ButtonState.Success:
        return 'success'
      case ButtonState.Error:
        return 'error'
      default:
        return null
    }
  }, [currentState])

  const handleClick: React.MouseEventHandler<HTMLDivElement> = useCallback(
    async (e) => {
      if (
        currentState !== ButtonState.Normal &&
        currentState !== ButtonState.Success &&
        currentState !== ButtonState.Error
      )
        return
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      e.stopPropagation()
      if (onClick) {
        setCurrentState(ButtonState.Loading)
        try {
          const result = await onClick()
          if (result === ButtonFeedback.Success) {
            setCurrentState(ButtonState.Success)
            timeoutRef.current = window.setTimeout(() => {
              timeoutRef.current = null
              setCurrentState(ButtonState.Normal)
            }, 2000)
          } else if (result === ButtonFeedback.Error) {
            setCurrentState(ButtonState.Error)
            timeoutRef.current = window.setTimeout(() => {
              timeoutRef.current = null
              setCurrentState(ButtonState.Normal)
            }, 2000)
          } else {
            setCurrentState(ButtonState.Normal)
          }
        } catch (error) {
          console.error('Component<Button> -> Unhandled error:', error)
          setCurrentState(ButtonState.Normal)
        }
      }
    },
    [onClick, currentState]
  )

  return (
    <div
      className={styles['button-container']}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      <div
        className={`${styles.button} ${isHovered ? styles.expand : ''} ${classNameState ? styles[classNameState] : ''}`}
      >
        <div className={styles.color}></div>
        <div className={styles['icon-container']}>
          <div className={styles.icon}>{icon}</div>
        </div>
        <div className={styles.name}>{name}</div>
      </div>
      {currentState === ButtonState.Loading ? <LoadingBorder /> : <></>}
      {isHovered && currentState === ButtonState.Normal ? <RainbowBorder /> : <></>}
    </div>
  )
}

export default Button
