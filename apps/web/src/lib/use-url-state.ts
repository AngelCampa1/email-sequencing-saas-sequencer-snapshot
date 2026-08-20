import { useSearchParams } from 'react-router'

export function useUrlState(key: string, defaultValue?: string): [string, (next: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(key)
  const value = raw !== null ? raw : (defaultValue ?? '')

  function setValue(next: string) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (next === '' || next === defaultValue) {
        params.delete(key)
      } else {
        params.set(key, next)
      }
      return params
    })
  }

  return [value, setValue]
}
