import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { type SecretStore, fetchSecrets, upsertSecret } from '@/lib/optionsApi'

interface SecretsContextValue {
  secrets: SecretStore
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  saveSecret: (
    group: string,
    service: string,
    name: string,
    value: string
  ) => Promise<void>
}

const SecretsContext = createContext<SecretsContextValue | undefined>(undefined)

interface SecretsProviderProps {
  children: ReactNode
  initialSecrets?: SecretStore
  fetchOnMount?: boolean
}

export function SecretsProvider({
  children,
  initialSecrets = {},
  fetchOnMount = true
}: SecretsProviderProps) {
  const [secrets, setSecrets] = useState<SecretStore>(initialSecrets)
  const [loading, setLoading] = useState<boolean>(fetchOnMount)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSecrets()
      if (mountedRef.current) {
        setSecrets(result)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load secrets')
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!fetchOnMount) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    fetchSecrets()
      .then((result) => {
        if (!active) return
        setSecrets(result)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load secrets')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [fetchOnMount])

  const saveSecret = useCallback(
    async (group: string, service: string, name: string, value: string) => {
      setError(null)
      const response = await upsertSecret(group, service, name, value)
      if (mountedRef.current) {
        setSecrets(response.secrets ?? {})
      }
    },
    []
  )

  const contextValue = useMemo<SecretsContextValue>(
    () => ({ secrets, loading, error, refresh, saveSecret }),
    [secrets, loading, error, refresh, saveSecret]
  )

  return (
    <SecretsContext.Provider value={contextValue}>
      {children}
    </SecretsContext.Provider>
  )
}

export function useSecrets() {
  const ctx = useContext(SecretsContext)
  if (!ctx) {
    throw new Error('useSecrets must be used within a SecretsProvider')
  }
  return ctx
}
