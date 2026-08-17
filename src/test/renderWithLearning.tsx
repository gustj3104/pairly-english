import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { LearningProvider } from '../state/LearningContext'

export function renderWithLearning(ui: ReactElement) {
  return render(<LearningProvider>{ui}</LearningProvider>)
}
