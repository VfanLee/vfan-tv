import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@renderer/components/ui/alert-dialog'

interface ConfirmDialogProps {
  cancelText?: string
  confirmText?: string
  description?: string
  title: string
  onCancel: () => void
  onConfirm: () => Promise<void> | void
}

export function ConfirmDialog({
  cancelText = '取消',
  confirmText = '确定',
  description,
  title,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  const [isConfirming, setIsConfirming] = useState(false)

  const confirm = async (): Promise<void> => {
    setIsConfirming(true)
    try {
      await onConfirm()
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !isConfirming) {
          onCancel()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isConfirming} onClick={onCancel}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isConfirming}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault()
              void confirm()
            }}
          >
            {isConfirming ? '处理中...' : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
