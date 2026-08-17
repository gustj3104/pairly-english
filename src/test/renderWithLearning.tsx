import { render } from '@testing-library/react'
import { useEffect, type ReactElement } from 'react'
import { LearningProvider, useLearning } from '../state/LearningContext'

interface Options {
  /** Preloads the in-memory (non-persisted) selected audio file before the wrapped UI mounts. */
  audioFile?: File
}

function AudioFileSeed({ file, children }: { file: File; children: ReactElement }) {
  const { setAudioFile } = useLearning()
  useEffect(() => setAudioFile(file), []) // eslint-disable-line react-hooks/exhaustive-deps
  return children
}

export function renderWithLearning(ui: ReactElement, options: Options = {}) {
  const content = options.audioFile ? <AudioFileSeed file={options.audioFile}>{ui}</AudioFileSeed> : ui
  return render(<LearningProvider>{content}</LearningProvider>)
}
