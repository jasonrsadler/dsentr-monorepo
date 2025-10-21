import { render } from '@testing-library/react'
import { type ReactElement } from 'react'
import { SecretsProvider } from '@/contexts/SecretsContext'
import { type SecretStore } from '@/lib/optionsApi'

interface RenderWithSecretsOptions {
  secrets?: SecretStore
}

export function renderWithSecrets(
  ui: ReactElement,
  { secrets = {} }: RenderWithSecretsOptions = {}
) {
  return render(
    <SecretsProvider fetchOnMount={false} initialSecrets={secrets}>
      {ui}
    </SecretsProvider>
  )
}
