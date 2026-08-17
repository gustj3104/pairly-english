두 명이 함께 영어 뉴스를 읽고, 글을 작성하고, 토론하며 영어 표현을 교정받는 웹 서비스 UI를 디자인해줘.

서비스명은 임시로 “Pairly English”를 사용한다.

## 1. 서비스 목적

두 명의 학습 파트너가 요일별 영어 뉴스 학습을 함께 진행한다.

핵심 학습 흐름은 다음과 같다.

1. 오늘의 영어 뉴스 확인
2. 뉴스 읽기
3. 핵심 단어 10~20개 선택 및 암기
4. 선택한 단어를 활용하여 영어 독후감 작성
5. 파트너의 독후감 작성 완료 대기
6. AI가 두 글의 공통 의견과 반대 의견 분석
7. AI가 토론 주제 추천
8. 두 사람이 영어로 토론
9. 토론 음성파일 업로드
10. AI가 문법 오류와 어색한 표현을 교정
11. 학습 기록 저장

뉴스는 외부 AI API를 통해 요일별 주제에 맞는 실제 영어 뉴스가 선택되는 구조다.

## 2. 디자인 방향

* 깔끔하고 지적인 영어 학습 서비스
* 두 사람이 함께 공부한다는 느낌이 명확하게 드러나야 함
* 일반적인 교육 서비스보다 현대적이고 친근한 분위기
* 과도하게 아동용이거나 게임처럼 보이지 않도록 함
* 학습 진행 상태와 파트너의 진행 상태를 한눈에 확인할 수 있어야 함
* 긴 영어 기사와 독후감을 편안하게 읽고 쓸 수 있는 레이아웃
* Desktop First, Mobile Responsive
* 데스크톱 기준 최대 콘텐츠 너비 1200px
* 카드 기반 레이아웃과 충분한 여백 사용
* 라운드 처리된 카드와 버튼, 부드러운 그림자
* 접근성을 고려한 충분한 명도 대비
* 본문 글꼴은 가독성이 높은 Sans-serif
* 영문 기사 제목에는 세련된 Serif 또는 강한 Sans-serif 사용 가능

### 컬러

* Primary: Deep Navy 또는 Indigo
* Accent: Soft Lime 또는 Mint
* Background: Warm White
* Success: Green
* Warning/Waiting: Amber
* Error/Correction: Coral Red

두 사용자는 서로 다른 포인트 컬러로 구분한다.

* Me: Indigo
* Partner: Mint

## 3. 공통 레이아웃

상단 내비게이션:

* Pairly English 로고
* Today
* Weekly Plan
* Review
* 우측에 연속 학습일, 알림, 프로필

학습 화면에는 다음 단계가 표시되는 Step Progress Bar를 고정적으로 제공한다.

* Read
* Vocabulary
* Write
* Compare
* Discuss
* Feedback

각 단계는 완료, 진행 중, 대기 상태가 명확히 구분되어야 한다.

## 4. 페이지 구성

### A. 로그인 및 파트너 연결

첫 화면에서는 서비스의 핵심 메시지를 보여준다.

메인 카피:
“Read differently. Think together. Speak better.”

서브 카피:
“영어 뉴스를 읽고, 서로의 생각을 비교하고, 대화하며 영어를 배워보세요.”

CTA:

* Get Started
* Join with Invite Code

파트너 연결 화면:

* 내 이름 또는 닉네임 입력
* 초대 링크 생성
* 초대 코드 복사
* 파트너 연결 대기 상태
* 연결 완료 시 두 사람의 프로필이 나란히 표시됨

### B. 온보딩 및 학습 설정

두 사람이 함께 사용할 기본 학습 설정 화면을 만든다.

설정 항목:

* 영어 수준: Beginner / Intermediate / Advanced
* 관심 뉴스 주제 복수 선택
* 정치·사회
* 과학·기술
* 경제·비즈니스
* 문화·예술
* 환경
* 라이프스타일
* 스포츠
* 학습 요일 선택
* 하루 목표 단어 수: 10 / 15 / 20
* 선호 기사 길이: Short / Medium / Long

마지막에는 Weekly News Plan 미리보기를 보여준다.

예시:

* Monday: Technology
* Tuesday: Society
* Wednesday: Business
* Thursday: Culture
* Friday: Environment

### C. Today Dashboard

가장 중요한 메인 화면이다.

상단:

* “Good evening, Hyunji”
* 오늘 날짜와 학습 연속일
* 이번 주 진행률

오늘의 뉴스 카드:

* 요일과 주제
* 기사 제목
* 기사 대표 이미지
* 출처와 발행일
* 예상 독해 시간
* 난이도
* 기사 요약 2~3줄
* Start Reading CTA
* 원문 출처 링크

파트너 진행 상태 카드:

* Me와 Partner를 나란히 표시
* 각 사용자별 현재 단계
* 오늘 학습 완료 여부
* 선택한 단어 수
* 독후감 작성 여부
* 음성 업로드 여부

주간 캘린더:

* 월요일부터 일요일까지 표시
* 각 날짜의 뉴스 주제
* 완료, 진행 중, 미완료 상태
* 오늘 날짜 강조

### D. News Reader

영어 기사 읽기에 집중할 수 있는 화면이다.

메인 영역:

* 기사 제목
* 대표 이미지
* 출처, 기자, 날짜
* 난이도와 예상 독해 시간
* 영어 기사 본문
* 원문 링크와 출처 표시

우측 고정 패널:

* My Vocabulary
* 선택한 단어 개수: 7/15
* 저장한 단어 목록
* Continue to Vocabulary CTA

기사 본문에서 단어를 클릭하거나 드래그하면 작은 팝업을 표시한다.

팝업 내용:

* 단어
* 품사
* 영어 정의
* 한국어 뜻
* 기사 속 예문
* 발음 듣기 아이콘
* Add to Vocabulary 버튼

이미 저장한 단어는 본문에서 연한 Indigo 배경으로 강조한다.

### E. Vocabulary Study

선택한 10~20개의 단어를 학습하는 화면이다.

상단:

* 목표 단어 수와 현재 선택 수
* “Use these words in your reflection.”

단어 카드:

* 단어
* 발음
* 품사
* 한국어 뜻
* 영어 정의
* 기사 속 문장
* 내가 작성하는 예문
* 암기 완료 체크
* 삭제 또는 교체

학습 모드:

* List View
* Flashcard View

하단 CTA:

* Start Writing
* 단어 수가 목표보다 적을 경우 비활성화 상태와 안내 문구 표시

### F. Reflection Writing

뉴스에 대한 영어 독후감 또는 의견문을 작성하는 화면이다.

화면을 좌우 2단으로 구성한다.

왼쪽:

* 기사 제목과 짧은 요약
* 선택한 단어 목록
* 사용한 단어는 체크 표시
* 아직 사용하지 않은 단어는 흐리게 표시

오른쪽:

* 제목 입력
* 영어 독후감 작성 에디터
* 단어 수
* 사용한 필수 단어 수
* 자동 저장 상태
* Save Draft
* Submit Reflection

작성 가이드 질문:

* What was the main point of the article?
* What did you find most interesting?
* Do you agree with the article?
* How does this issue affect society or your life?

선택한 단어가 글에 사용되면 본문과 단어 목록에서 자동으로 강조되는 UI를 표현한다.

제출 전 확인 모달:

* 제출 후에는 AI 비교 분석이 시작됨
* 파트너가 아직 제출하지 않았다면 대기하게 됨
* Edit More
* Submit

### G. Partner Waiting State

내 독후감 제출 후 파트너가 아직 작성 중일 때 보여주는 화면이다.

* 내 단계: Reflection completed
* 파트너 단계: Writing in progress
* 두 사람의 진행 상태를 시각적으로 표시
* “Your partner is still writing.”
* 파트너에게 알림 보내기 버튼
* 내 글 다시 읽기
* 저장한 단어 복습하기

압박감을 주지 않는 부드러운 대기 화면으로 디자인한다.

### H. AI Opinion Comparison

두 사람의 독후감 제출이 완료되면 나타나는 핵심 화면이다.

상단 요약:

* “You read the same story differently.”
* 두 사용자 프로필
* AI 분석 완료 표시

분석 카드:

1. Common Ground

   * 두 사람이 공통으로 동의한 의견
   * 각 독후감의 관련 문장 표시

2. Different Perspectives

   * 의견이 다르거나 강조점이 다른 부분
   * Me와 Partner의 의견을 좌우 비교

3. Questions Worth Discussing

   * AI가 추천한 토론 주제 3개
   * 각 주제별 추천 이유
   * 예상 난이도
   * Select Topic 버튼

AI 분석은 사실 판정이 아니라 두 글의 관점을 비교한 결과임을 알리는 작은 안내 문구를 넣는다.

### I. Discussion Room

선택한 토론 주제를 바탕으로 두 사람이 대화를 준비하는 화면이다.

상단:

* 선택한 토론 질문
* 기사 제목
* 토론 목표 시간
* 타이머

토론 지원 영역:

* Discussion Guide
* Opening Question
* Follow-up Questions
* Useful Expressions
* Agreeing
* Disagreeing politely
* Asking for clarification
* Giving examples

두 사람의 핵심 의견을 작은 카드로 다시 보여준다.

음성 영역:

* 녹음 시작 버튼
* 또는 음성파일 업로드
* 지원 형식과 최대 용량 안내
* 업로드 진행률
* 파일명과 재생 컨트롤
* Analyze Conversation CTA

실제 실시간 통화 기능처럼 만들지 말고, 두 사람이 오프라인 또는 외부 통화로 대화한 후 하나의 음성파일을 업로드하는 흐름으로 설계한다.

### J. AI Speaking Feedback

업로드한 대화의 분석 결과 화면이다.

상단 요약 카드:

* 대화 시간
* 총 발화 수
* 사용한 학습 단어 수
* 문법 교정 수
* 자연스러운 표현 제안 수

탭 구성:

* Transcript
* Grammar
* Natural Expressions
* Vocabulary

Transcript 탭:

* 화자 A와 화자 B를 색상으로 구분
* 타임스탬프
* 교정이 필요한 문장에 밑줄
* 문장을 클릭하면 상세 교정 패널 표시

교정 카드:

* Original
* Corrected
* More Natural
* 짧은 한국어 설명
* 오류 유형 태그: Tense / Article / Preposition / Word Choice / Sentence Structure
* 발음 듣기 아이콘
* Save Expression

중요한 표현은 Before → After 비교 형식으로 보여준다.

하단:

* 오늘 학습 완료 처리
* Review Saved Expressions
* Back to Dashboard

### K. Weekly Plan

주간 학습 현황을 캘린더 또는 타임라인으로 보여준다.

각 날짜에 표시할 내용:

* 뉴스 주제
* 기사 제목
* 두 사람의 완료 여부
* 현재 학습 단계
* 저장한 단어 수
* 토론 완료 여부

이번 주 요약:

* 함께 읽은 기사 수
* 학습한 단어 수
* 작성한 글 수
* 토론 시간
* 연속 학습일

### L. Review Archive

과거 학습 기록을 다시 볼 수 있는 화면이다.

검색 및 필터:

* 날짜
* 뉴스 주제
* 완료 상태
* 저장한 단어
* 문법 오류 유형

기록 카드:

* 기사 제목과 출처
* 작성한 독후감
* 공통·반대 의견 요약
* 선택한 토론 주제
* 대화 음성
* AI 교정 결과
* 저장한 표현

Vocabulary Bank와 Saved Corrections를 별도 탭으로 제공한다.

## 5. 주요 상태 디자인

각 핵심 화면에 다음 상태도 함께 디자인한다.

* Loading: AI가 뉴스를 선택하거나 글을 분석하는 중
* Empty: 아직 학습 기록이 없음
* Waiting: 파트너의 작성이나 업로드를 기다리는 중
* Error: API 분석 또는 파일 업로드 실패
* Completed: 오늘의 모든 학습 완료
* Locked: 이전 단계가 끝나지 않아 다음 단계에 접근할 수 없음

AI 처리 화면에는 단순한 스피너 대신 작업 내용을 보여준다.

예시:

* Reading both reflections
* Finding common viewpoints
* Detecting different perspectives
* Creating discussion questions

## 6. 컴포넌트

재사용 가능한 디자인 시스템 컴포넌트를 만든다.

* Primary / Secondary / Ghost Button
* User Avatar
* Partner Status Badge
* Learning Step Indicator
* Progress Bar
* News Card
* Vocabulary Card
* Opinion Comparison Card
* Discussion Topic Card
* Correction Card
* Audio Upload Box
* Audio Player
* Tabs
* Tooltip
* Modal
* Toast
* Empty State
* Loading State
* Error State

버튼과 입력창은 Default, Hover, Focus, Disabled, Loading 상태를 포함한다.

## 7. 프로토타입 핵심 경로

다음 사용자 흐름이 자연스럽게 연결되도록 화면을 구성한다.

Login
→ Partner Connection
→ Onboarding
→ Today Dashboard
→ News Reader
→ Vocabulary Study
→ Reflection Writing
→ Partner Waiting
→ AI Opinion Comparison
→ Discussion Room
→ Audio Upload
→ AI Speaking Feedback
→ Learning Completed
→ Dashboard

각 화면에는 사용자가 다음에 무엇을 해야 하는지 알 수 있는 하나의 명확한 Primary CTA를 배치한다.

디자인에는 실제 서비스처럼 보이는 영어 뉴스, 단어, 독후감, 토론 주제, 문법 교정 예시 데이터를 사용한다. Lorem ipsum은 사용하지 않는다.
