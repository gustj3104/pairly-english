export interface VocabWord {
  word: string
  pron: string
  pos: string
  kr: string
  def: string
  sentence: string
}

export interface Article {
  id: string
  title: string
  topic: string
  source: string
  author: string
  date: string
  readTime: string
  level: string
  imageUrl: string
  paragraphs: { id: string; text: string }[]
  summary: string
  /** Vocabulary tied to this specific article — future articles can carry 10-20 words. */
  vocabulary: VocabWord[]
}

const TODAY_ARTICLE: Article = {
  id: 'k-culture-hollywood',
  title: "The Quiet Revolution: How K-Culture Is Rewriting Hollywood's Playbook",
  topic: 'Culture',
  source: 'The Atlantic',
  author: 'Eleanor Park',
  date: 'August 14, 2025',
  readTime: '6 min read',
  level: 'Intermediate',
  imageUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=900&h=400&fit=crop&auto=format',
  summary: 'Korean cultural exports have quietly dismantled the assumption that global entertainment flows in one direction, reshaping the grammar of global entertainment.',
  paragraphs: [
    { id: 'p1', text: 'When Bong Joon-ho clutched his Oscars in 2020, many in the entertainment industry treated it as a pleasant anomaly — a foreign film that somehow broke through. Five years later, it is clear that Parasite was not a fluke but a harbinger. Korean pop culture has not merely found an international audience; it has begun to reshape the very grammar of global entertainment.' },
    { id: 'p2', text: 'The phenomenon is sometimes reduced to the K-pop fandom, with its elaborate fan culture, meticulously choreographed performances, and algorithmic mastery of YouTube and TikTok. But the Korean wave — known domestically as hallyu — runs far deeper. Korean cinema, television dramas, fashion, food, and even language learning have all surged in global popularity over the past decade, creating an ecosystem of cultural influence that rivals, and in some demographics surpasses, that of Hollywood.' },
    { id: 'p3', text: 'The success is no accident. The Korean government began investing in its cultural industries as a deliberate economic strategy following the 1997 Asian financial crisis. What followed was a systematic cultivation of creative infrastructure: a subsidy for film schools, export incentives for production companies, and diplomatic soft power deployed through cultural centers worldwide. The result is an industry that blends genuine artistic ambition with extraordinary commercial discipline, though critics note this scale still challenges the long-standing hegemony of Western studios.' },
    { id: 'p4', text: "Hollywood's response has been characteristically ambivalent. Studios have hired Korean directors, acquired remake rights to popular dramas, and begun casting Korean actors in major productions. Yet the deeper challenge — whether Western studios can genuinely absorb Korean storytelling sensibilities rather than merely appropriating their surface aesthetic — remains unresolved. The risk is what some scholars call aesthetic laundering: taking the visual vocabulary of a foreign culture while stripping it of the specific social critique that made it resonate." },
  ],
  vocabulary: [
    { word: 'harbinger', pron: '/ˈhɑːrbɪndʒər/', pos: 'noun', kr: '선구자, 전조', def: 'A person or thing that signals the approach of another', sentence: 'Parasite was not a fluke but a harbinger.' },
    { word: 'hallyu', pron: '/ˈhæljuː/', pos: 'noun', kr: '한류 (韓流)', def: 'The spread of South Korean culture globally', sentence: 'The Korean wave — known domestically as hallyu — runs far deeper.' },
    { word: 'ambivalent', pron: '/æmˈbɪvələnt/', pos: 'adjective', kr: '양가적인, 모호한', def: 'Having mixed or contradictory feelings about something', sentence: "Hollywood's response has been characteristically ambivalent." },
    { word: 'subsidy', pron: '/ˈsʌbsɪdi/', pos: 'noun', kr: '보조금', def: 'A sum of money granted by the government to assist an industry', sentence: 'Subsidies for film schools drove creative infrastructure growth.' },
    { word: 'aesthetic', pron: '/esˈθetɪk/', pos: 'adjective', kr: '미적인, 심미적인', def: 'Concerned with beauty or the appreciation of beauty', sentence: 'The risk is what scholars call aesthetic laundering.' },
    { word: 'infrastructure', pron: '/ˈɪnfrəstrʌktʃər/', pos: 'noun', kr: '인프라, 기반 시설', def: 'The basic physical and organizational structures needed for operation', sentence: 'A systematic cultivation of creative infrastructure followed.' },
    { word: 'hegemony', pron: '/hɪˈdʒeməni/', pos: 'noun', kr: '패권, 지배력', def: 'Leadership or dominance, especially of one country over others', sentence: 'Korean culture began to challenge American cultural hegemony.' },
    { word: 'meticulously', pron: '/mɪˈtɪkjʊləsli/', pos: 'adverb', kr: '꼼꼼하게, 세심하게', def: 'In a way that shows great attention to detail and careful precision', sentence: 'Meticulously choreographed performances captivate global audiences.' },
  ],
}

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms))
}

export function getTodayArticle(): Promise<Article> {
  return delay(TODAY_ARTICLE)
}

export function findVocabWord(vocabulary: VocabWord[], word: string): VocabWord | undefined {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '')
  return vocabulary.find(v => v.word === lower)
}

/**
 * Word-goal ratios applied to an article's own vocabulary count, so a
 * future 20-word article scales goals automatically instead of relying
 * on numbers tuned for today's 8-word list.
 */
export const VOCAB_GOAL_RATIOS = {
  select: 0.75,
  memorize: 0.75,
  reflectionUse: 0.5,
}

export interface VocabGoals {
  total: number
  selectGoal: number
  memorizeGoal: number
  reflectionUseGoal: number
}

export function getVocabGoals(article: Article): VocabGoals {
  const total = article.vocabulary.length
  const clamp = (n: number) => Math.min(total, Math.max(1, n))
  return {
    total,
    selectGoal: clamp(Math.ceil(total * VOCAB_GOAL_RATIOS.select)),
    memorizeGoal: clamp(Math.ceil(total * VOCAB_GOAL_RATIOS.memorize)),
    reflectionUseGoal: clamp(Math.ceil(total * VOCAB_GOAL_RATIOS.reflectionUse)),
  }
}
