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

    const modeButton = screen.getByRole('button', {
      name: /wait for duration/i
    })
    fireEvent.click(modeButton)
    fireEvent.click(screen.getByText(/wait until specific datetime/i))

    const dateInput = screen.getByLabelText('Date (UTC)')
    fireEvent.change(dateInput, { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Minute'), {
      target: { value: '2' }
    })
    fireEvent.change(screen.getByLabelText('Second'), {
      target: { value: '3' }
    })

    await waitFor(() => {
      expect(
        screen.queryByText(/configure a duration or an absolute time/i)
      ).not.toBeInTheDocument()
    })
  })
})
