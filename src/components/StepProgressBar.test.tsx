import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StepProgressBar from './StepProgressBar'

describe('StepProgressBar', () => {
  it('renders all step labels', () => {
    render(<StepProgressBar currentStep={1} completedUpTo={1} />)

    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Vocabulary')).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getByText('Compare')).toBeInTheDocument()
    expect(screen.getByText('Discuss')).toBeInTheDocument()
    expect(screen.getByText('Feedback')).toBeInTheDocument()
  })

  it('shows a plain number for a step that has not been reached yet', () => {
    render(<StepProgressBar currentStep={0} completedUpTo={0} />)

    expect(screen.getByText('6')).toBeInTheDocument()
  })
})
