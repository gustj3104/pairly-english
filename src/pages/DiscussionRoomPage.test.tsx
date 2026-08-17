import { fireEvent, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import DiscussionRoomPage from './DiscussionRoomPage'
import { MAX_AUDIO_FILE_SIZE_BYTES } from '../services/mockAIService'

beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:mock')
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn()
  }
})

function selectFile(file: File) {
  const input = screen.getByLabelText('Select discussion audio file')
  fireEvent.change(input, { target: { files: [file] } })
}

describe('DiscussionRoomPage', () => {
  it('shows the selected audio file and enables the analyze step', () => {
    renderWithLearning(<DiscussionRoomPage setPage={vi.fn()} />)

    expect(screen.queryByText('Analyze Conversation →')).not.toBeInTheDocument()

    selectFile(new File(['fake-audio-bytes'], 'discussion.mp3', { type: 'audio/mpeg' }))

    expect(screen.getByText('discussion.mp3')).toBeInTheDocument()
    expect(screen.getByText('Analyze Conversation →')).toBeInTheDocument()

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.discussion.audioFileName).toBe('discussion.mp3')
  })

  it('rejects an unsupported audio format', () => {
    renderWithLearning(<DiscussionRoomPage setPage={vi.fn()} />)

    selectFile(new File(['not audio'], 'notes.txt', { type: 'text/plain' }))

    expect(screen.getByText(/Unsupported audio format/)).toBeInTheDocument()
    expect(screen.queryByText('Analyze Conversation →')).not.toBeInTheDocument()
  })

  it('rejects a file over the size limit', () => {
    renderWithLearning(<DiscussionRoomPage setPage={vi.fn()} />)

    const tooBig = new File(['x'], 'huge.mp3', { type: 'audio/mpeg' })
    Object.defineProperty(tooBig, 'size', { value: MAX_AUDIO_FILE_SIZE_BYTES + 1 })
    selectFile(tooBig)

    expect(screen.getByText(/too large/)).toBeInTheDocument()
    expect(screen.queryByText('Analyze Conversation →')).not.toBeInTheDocument()
  })

  it('prompts to reselect a file that was chosen before a refresh', () => {
    localStorage.setItem('pairly:state:v1', JSON.stringify({
      discussion: { selectedTopicIndex: 0, selectedTopicText: null, audioFileName: 'old-recording.mp3' },
    }))
    renderWithLearning(<DiscussionRoomPage setPage={vi.fn()} />)

    expect(screen.getByText(/old-recording.mp3/)).toBeInTheDocument()
    expect(screen.getByText(/please choose it again/)).toBeInTheDocument()
  })
})
