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
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'

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
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const workspaceId = currentWorkspace?.workspace.id ?? null

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setSecrets({})
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await fetchSecrets(workspaceId)
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
  }, [workspaceId])

  useEffect(() => {
    if (!fetchOnMount) {
      setLoading(false)
      return
    }

    let active = true
    if (!workspaceId) {
      setSecrets({})
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    fetchSecrets(workspaceId)
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
  }, [fetchOnMount, workspaceId])

  const saveSecret = useCallback(
    async (group: string, service: string, name: string, value: string) => {
      if (!workspaceId) {
        throw new Error('Workspace required to save secrets')
      }

      setError(null)
      const response = await upsertSecret(
        group,
        service,
        name,
        value,
        workspaceId
      )
      if (mountedRef.current) {
        setSecrets(response.secrets ?? {})
      }
    },
    [workspaceId]
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
