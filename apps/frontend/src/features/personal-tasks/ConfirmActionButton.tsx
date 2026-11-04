import React from 'react'

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  confirmLabel: React.ReactNode
  onConfirm(): void
}

export default function ConfirmActionButton({ children, confirmLabel, disabled, onConfirm, ...props }: Props) {
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => { if (disabled) setArmed(false) }, [disabled])
  return <button {...props} type="button" disabled={disabled} className={`${props.className || ''} ${armed ? 'is-danger-confirm' : ''}`.trim()}
    onBlur={() => setArmed(false)} onClick={() => {
      if (!armed) { setArmed(true); return }
      setArmed(false)
      onConfirm()
    }}>{armed ? confirmLabel : children}</button>
}
