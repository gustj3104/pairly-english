import { fireEvent, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderWithLearning } from '../test/renderWithLearning'
import DiscussionRoomPage from './DiscussionRoomPage'

beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:mock')
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn()
  }
})

describe('DiscussionRoomPage', () => {
  it('shows the selected audio file and enables the analyze step', () => {
    renderWithLearning(<DiscussionRoomPage setPage={vi.fn()} />)

    expect(screen.queryByText('Analyze Conversation →')).not.toBeInTheDocument()

    const file = new File(['fake-audio-bytes'], 'discussion.mp3', { type: 'audio/mpeg' })
    const input = screen.getByLabelText('Select discussion audio file')
    fireEvent.change(input, { target: { files: [file] } })

    expect(screen.getByText('discussion.mp3')).toBeInTheDocument()
    expect(screen.getByText('Analyze Conversation →')).toBeInTheDocument()

    const saved = JSON.parse(localStorage.getItem('pairly:state:v1') ?? '{}')
    expect(saved.discussion.audioFileName).toBe('discussion.mp3')
  })
})
