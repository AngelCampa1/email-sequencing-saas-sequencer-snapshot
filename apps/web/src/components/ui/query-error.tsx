import { AlertTriangle, RefreshCw } from 'lucide-react'
import { formatQueryError } from '../../lib/query-error'
import { Button } from './button'
import { Spinner } from './spinner'

interface QueryErrorProps {
  title: string
  error: unknown
  onRetry?: () => void
  isRetrying?: boolean
}

export function QueryError({ title, error, onRetry, isRetrying = false }: QueryErrorProps) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-medium text-red-900">{title}</p>
            <p className="mt-1 text-sm text-red-700">{formatQueryError(error)}</p>
          </div>
        </div>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={isRetrying}
            className="shrink-0 border-red-200 text-red-700 hover:bg-red-100"
          >
            {isRetrying ? <Spinner size={13} label="Retrying" /> : <RefreshCw size={13} />}{' '}
            {isRetrying ? 'Retrying' : 'Retry'}
          </Button>
        )}
      </div>
    </div>
  )
}
