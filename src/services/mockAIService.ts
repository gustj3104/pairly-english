/**
 * Mock stand-ins for the Mindlogic AI endpoints. Each function keeps the
 * shape (args in, Promise<Result> out) that the real API call will have,
 * so swapping the body for a real request later doesn't touch any caller.
 */

import type { CompareReflectionsRequest, ComparisonResult, DiscussionTopic } from './api/schemas'

export type { DiscussionTopic, ComparisonResult }

export interface GrammarIssue {
  original: string
  corrected: string
  type: string
  reason: string
  natural: string
}

export interface NaturalExpression {
  original: string
  natural: string
  explanation: string
}

export interface TranscriptLine {
  speaker: 'A' | 'B'
  time: string
  text: string
  corrections: string[]
}

export interface FeedbackResult {
  duration: string
  utterances: number
  transcript: TranscriptLine[]
  grammarIssues: GrammarIssue[]
  expressions: NaturalExpression[]
  vocabularyUsed: { word: string; used: boolean }[]
}

function delay<T>(value: T, ms = 900): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms))
}

export function compareReflections(_input: CompareReflectionsRequest): Promise<ComparisonResult> {
  return delay({
    requestId: 'mock-request-id',
    commonGround: [
      {
        point: "Korean culture's global rise is unprecedented and historically significant",
        mine: '"...Parasite was not a fluke but a harbinger of something larger that was already in motion."',
        partner: '"The scale of hallyu in 2025 is something that scholars predicted but few believed would happen this quickly."',
      },
      {
        point: 'Government investment played a key role in building the cultural infrastructure',
        mine: '"...systematic subsidies created the conditions for both artistic ambition and commercial discipline."',
        partner: '"The 1997 financial crisis paradoxically created the foundation for Korean soft power — necessity driving innovation."',
      },
    ],
    differences: [
      {
        topic: "Hollywood's response to K-culture",
        mine: { stance: 'Cautiously optimistic', quote: '"The hiring of Korean directors suggests genuine openness — Hollywood can learn from a different storytelling tradition."' },
        partner: { stance: 'Skeptical', quote: '"Studios are appropriating the surface aesthetics of K-culture without engaging with its social critique — classic aesthetic laundering."' },
      },
      {
        topic: 'The role of government in cultural production',
        mine: { stance: 'Supportive', quote: '"Strategic investment in creative industries is legitimate soft power — economic success validates the approach."' },
        partner: { stance: 'Concerned', quote: '"When governments systematically cultivate culture for export, there is a risk of homogenizing art to fit marketable narratives."' },
      },
    ],
    topics: [
      {
        question: "Is K-culture's global rise a result of genuine artistic quality, or primarily effective marketing strategy?",
        reason: 'Both reflections touch on this tension differently — one side emphasized artistic merit, the other focused on systematic commercial strategy.',
        difficulty: 'Intermediate',
      },
      {
        question: 'Should governments subsidize cultural industries as a form of soft power? What are the risks?',
        reason: 'One reflection raised concerns about government-directed art losing authenticity, while the other suggested economic benefits outweigh the risks.',
        difficulty: 'Advanced',
      },
      {
        question: 'Does the global popularity of Korean culture challenge Western cultural hegemony, or simply add to it?',
        reason: 'A direct extension of the "aesthetic laundering" concept in the article — both writers engaged with this idea from different angles.',
        difficulty: 'Advanced',
      },
    ],
  })
}

/** Extensions accepted for a discussion recording, until Mindlogic specifies its own list. */
export const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'webm']

/** Common MIME types browsers report for the extensions above. */
export const SUPPORTED_AUDIO_MIME_TYPES = [
  'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a',
  'audio/webm',
]

/** Temporary cap until Mindlogic's upload endpoint specifies its own limit. */
export const MAX_AUDIO_FILE_SIZE_BYTES = 100 * 1024 * 1024

export interface AudioValidationResult {
  valid: boolean
  error?: string
}

export function validateAudioFile(file: File): AudioValidationResult {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const extensionOk = SUPPORTED_AUDIO_EXTENSIONS.includes(extension)
  const mimeOk = SUPPORTED_AUDIO_MIME_TYPES.includes(file.type.toLowerCase())

  if (!extensionOk && !mimeOk) {
    return { valid: false, error: `Unsupported audio format. Use ${SUPPORTED_AUDIO_EXTENSIONS.join(', ')}.` }
  }
  if (file.size === 0) {
    return { valid: false, error: 'The selected file is empty.' }
  }
  if (file.size > MAX_AUDIO_FILE_SIZE_BYTES) {
    return { valid: false, error: `File is too large. Max size is ${Math.round(MAX_AUDIO_FILE_SIZE_BYTES / (1024 * 1024))}MB.` }
  }
  return { valid: true }
}

/**
 * Only the file's metadata (name/size/type) informs the mock response —
 * the bytes are never read or sent anywhere, matching the "preview only,
 * no external transfer" requirement for audio in this mock phase.
 */
export function analyzeAudio(file: File): Promise<FeedbackResult> {
  const validation = validateAudioFile(file)
  if (!validation.valid) {
    return Promise.reject(new Error(validation.error))
  }

  return delay({
    duration: '14:32',
    utterances: 48,
    transcript: [
      { speaker: 'A', time: '0:05', text: "So, I think the main reason K-culture became so popular is because the quality was genuinely good. Like, Parasite wasn't successful just because of marketing — it was a masterpiece.", corrections: [] },
      { speaker: 'B', time: '1:12', text: 'I agree to some extent, but I think we should also consider the role of the government subsidies. Without those investment, the infrastructure could not have been built.', corrections: ['subsidies', 'those investment → that investment'] },
      { speaker: 'A', time: '2:30', text: "That's fair. But does that mean the art is less authentic? I don't think government support automatically makes something less genuine.", corrections: [] },
      { speaker: 'B', time: '3:45', text: 'Not necessarily. But what concern me is that when you design culture for export, you risk losing the specific social critique that made it resonate in the first place.', corrections: ['what concern me → what concerns me'] },
      { speaker: 'A', time: '5:02', text: "That's a really interesting point. I hadn't thought about the aesthetic laundering idea from this angle. Do you think Hollywood is guilty of this with their Korean remakes?", corrections: [] },
      { speaker: 'B', time: '6:18', text: 'Absolutely. They take the visual style but they remove the class commentary. Parasite worked in Korean because it spoke to very specific Korean anxieties about wealth gap.', corrections: ['about wealth gap → about the wealth gap'] },
    ],
    grammarIssues: [
      { original: 'Without those investment, the infrastructure...', corrected: 'Without that investment, the infrastructure...', type: 'Article', reason: "'Investment'는 불가산 명사이므로 'those' 대신 'that'을 사용해야 합니다.", natural: 'Without sufficient investment in the sector, ...' },
      { original: 'what concern me is that...', corrected: 'what concerns me is that...', type: 'Tense', reason: "'What' 주어절에서 동사는 3인칭 단수 형태여야 합니다.", natural: 'My main concern is that...' },
      { original: 'about wealth gap', corrected: 'about the wealth gap', type: 'Article', reason: "특정 사회 현상을 지칭할 때 정관사 'the'가 필요합니다.", natural: 'about the growing wealth disparity' },
    ],
    expressions: [
      { original: 'the quality was genuinely good', natural: 'the quality genuinely stood out', explanation: "'stand out'은 특별히 뛰어나다는 뉘앙스를 더 잘 전달합니다." },
      { original: 'I agree to some extent', natural: "I'd partially agree with that", explanation: "'To some extent'보다 더 자연스러운 표현입니다." },
      { original: "That's a really interesting point", natural: "That's a compelling point, actually", explanation: "'Compelling'은 단순한 흥미보다 설득력 있다는 뉘앙스를 줍니다." },
    ],
    vocabularyUsed: [
      { word: 'harbinger', used: true },
      { word: 'hallyu', used: true },
      { word: 'ambivalent', used: true },
      { word: 'subsidy', used: true },
      { word: 'aesthetic', used: true },
      { word: 'infrastructure', used: true },
      { word: 'hegemony', used: false },
      { word: 'meticulously', used: false },
    ],
  }, 1100)
}
