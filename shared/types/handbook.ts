/** 不会 / 模糊 / 掌握 */
export type StudyStatus = 'weak' | 'fuzzy' | 'mastered'

export type UserRole = 'admin' | 'user'

export type QuestionStatus = 'draft' | 'published'

export interface TocItem {
  level: 2 | 3
  id: string
  text: string
}

export interface OutlineQuestion {
  id: number
  /** 全局题号，按目录顺序编号 */
  num: number
  slug: string
  title: string
  difficulty: number
  /** 页面路径，如 /basics/javascript/01-event-loop */
  path: string
}

export interface OutlineCategory {
  id: number
  slug: string
  title: string
  questions: OutlineQuestion[]
}

export interface OutlinePart {
  id: number
  slug: string
  title: string
  categories: OutlineCategory[]
}

export interface QuestionLink {
  title: string
  path: string
}

export interface QuestionDetail {
  id: number
  num: number
  title: string
  difficulty: number
  tags: string[]
  html: string
  /** 一句话回答的纯文本（截断到约 110 字），用作页面描述 */
  summary: string
  toc: TocItem[]
  path: string
  part: { slug: string; title: string }
  category: { slug: string; title: string }
  prev: QuestionLink | null
  next: QuestionLink | null
  updatedAt: string
}

export interface StudyRecord {
  status: StudyStatus | null
  starred: boolean
  note: string | null
  updatedAt: string
}

/** 学习记录按题目 id 索引 */
export type StudyRecordMap = Record<number, StudyRecord>

export interface InterviewTurn {
  /** 用户这一轮的回答 */
  answer: string
  /** AI 的点评（Markdown） */
  feedback: string
  /** 0~10 分，解析失败时为 null */
  score: number | null
  /** 下一轮追问，没有时为 null */
  followUp: string | null
  at: string
}

export interface InterviewSummary {
  id: number
  rounds: number
  score: number | null
  turns: InterviewTurn[]
  createdAt: string
  updatedAt: string
}

export interface SearchHit {
  id: number
  title: string
  path: string
  part: string
  category: string
  snippet: string
}

/** 复习评分：1 不会、2 模糊、3 会了、4 很熟（对应 FSRS 的 Again / Hard / Good / Easy） */
export type ReviewGrade = 1 | 2 | 3 | 4

/** 存进数据库的 FSRS 卡片（日期用 ISO 字符串） */
export interface StoredCard {
  due: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: number
  lastReview: string | null
}

/** 今日待复习的一道题 */
export interface ReviewItem {
  id: number
  num: number
  title: string
  path: string
  category: string
  difficulty: number
  status: StudyStatus | null
  /** 下次复习时间 */
  due: string
  reps: number
  lapses: number
  /** "一句话回答"的 HTML，复习时先自己想，再展开对照 */
  answerHtml: string
  /** 选每个评分后，下次复习在几天后 */
  intervals: Record<ReviewGrade, number>
}

export interface ReviewSummary {
  /** 今天（含逾期）要复习的题数 */
  dueToday: number
  /** 复习计划里的题数 */
  total: number
  /** 今天已经复习的题数 */
  doneToday: number
  /** 连续复习天数（今天还没复习时，从昨天往前数） */
  streak: number
  /** 未来 7 天每天到期的题数，第一项是今天（含逾期） */
  forecast: { date: string; count: number }[]
}

export type MockDifficulty = 'basic' | 'advanced' | 'deep' | 'mixed'

export interface MockConfig {
  /** bank 按方向从题库抽题；resume 按简历出项目深挖题，再搭配题库里的相关基础题 */
  mode?: 'bank' | 'resume'
  /** 方向，如 frontend、go-backend；自定义时为 custom；按简历出题时为 resume */
  track: string
  categoryIds: number[]
  difficulty: MockDifficulty
  count: number
  /** 每道题追问几次（0～2） */
  followUps: number
  /** 优先抽不会、模糊和到期该复习的题 */
  preferWeak: boolean
  /** 按简历出题时的目标岗位（简历原文不保存） */
  role?: string
}

/** 按简历生成的项目深挖题，不在题库里 */
export interface CustomQuestion {
  title: string
  /** 考察要点，评分时代替参考答案 */
  points: string[]
}

export interface MockItem {
  /** 题库里的题；按简历生成的题为 null，内容在 custom 里 */
  questionId: number | null
  custom?: CustomQuestion
  /** 按简历生成的题不写 interviews 表，问答记录存在这里 */
  turns?: InterviewTurn[]
  interviewId: number | null
  /** 每一轮的得分 */
  scores: (number | null)[]
  skipped: boolean
  /** 这道题是否已经答完（含追问）或跳过 */
  done: boolean
}

export interface MockQuestionInfo {
  id: number
  num: number
  title: string
  path: string
  category: string
  difficulty: number
}

export interface MockSessionSummary {
  id: number
  title: string
  status: 'active' | 'finished'
  count: number
  answered: number
  score: number | null
  createdAt: string
  finishedAt: string | null
}

export interface MockSessionDetail extends MockSessionSummary {
  config: MockConfig
  currentIndex: number
  items: (MockItem & { question: MockQuestionInfo; turns: InterviewTurn[]; points: string[] | null })[]
  report: string | null
}

/** 进度页薄弱点分析：某个分类的 AI 面试得分和到期复习数 */
export interface CategoryInsight {
  /** 每道题最近一次 AI 面试第一轮得分的平均值 */
  avgScore: number | null
  /** 面试过的题数 */
  interviewed: number
  /** 今天到期要复习的题数 */
  due: number
}

/** 学习周报里一周的汇总数字 */
export interface WeekStats {
  /** 阅读题目的有效时长（秒） */
  studySeconds: number
  /** 有学习记录的天数（阅读、复习、面试任意一种） */
  activeDays: number
  /** 读过的题数 */
  questionsRead: number
  /** 复习评分次数（复习页、题目页标记、AI 面试第一轮都算） */
  reviews: number
  /** 第一次加入复习计划的题数 */
  newQuestions: number
  /** AI 面试过的题数（单题和模拟面试） */
  interviews: number
  /** 这些面试第一轮的平均分 */
  interviewAvg: number | null
  /** 完成的整场模拟面试 */
  mockFinished: number
  mockAvg: number | null
  /** 自测模式里查看答案的次数 */
  reveals: number
  /** 语音作答的时长（秒） */
  voiceSeconds: number
}

export interface ReportSuggestion {
  text: string
  link?: { to: string; label: string }
}

export interface WeeklyReport {
  /** 周一到周日（用户所在时区的日期）；offset 0 是本周，-1 是上周 */
  week: { start: string; end: string; offset: number }
  current: WeekStats
  previous: WeekStats
  /** 本周每天：阅读秒数、复习次数、面试次数 */
  daily: { date: string; seconds: number; reviews: number; interviews: number }[]
  /** 最近 8 周（最后一项是这一周）：学习时长和面试平均分 */
  trend: { start: string; seconds: number; interviewAvg: number | null }[]
  /** 本周学过的分类，按学习时长排序 */
  categories: { id: number; title: string; seconds: number; interviews: number; avgScore: number | null; again: number }[]
  /** 本周最卡的题：AI 面试低分，或者复习时多次答"不会" */
  stuck: { id: number; title: string; path: string; category: string; reason: string }[]
  suggestions: ReportSuggestion[]
  streak: number
  dueToday: number
}
