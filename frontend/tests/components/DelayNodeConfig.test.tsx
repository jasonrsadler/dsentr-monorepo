import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import DelayNodeConfig from '@/components/actions/logic/DelayNode'
import {
  validateDelayConfig,
  type DelayConfig
} from '@/components/actions/logic/DelayNode/helpers'

describe('DelayNodeConfig', () => {
  it('validates configuration and emits changes for duration and absolute time', async () => {
    const Wrapper = () => {
      const [config, setConfig] = useState<DelayConfig>({})
      const hasErrors = validateDelayConfig(config)
      return (
        <DelayNodeConfig
          config={config}
          onChange={(next) => setConfig(next)}
          hasValidationErrors={hasErrors}
        />
      )
    }

    render(<Wrapper />)

    expect(
      screen.getByText(/configure a duration or an absolute time/i)
    ).toBeInTheDocument()

    const durationInputs = screen.getAllByPlaceholderText('0')
    fireEvent.change(durationInputs[2], { target: { value: '5' } })

    await waitFor(() => {
      expect(
        screen.queryByText(/configure a duration or an absolute time/i)
      ).not.toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('2025-12-31T23:59:00Z'), {
      target: { value: '2026-01-01T00:00:00Z' }
    })

    await waitFor(() => {
      expect(
        screen.queryByText(/configure a duration or an absolute time/i)
      ).not.toBeInTheDocument()
    })
  })
})
