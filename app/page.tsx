// app/page.tsx
// - ProjNow 랜딩(커버) 페이지
// ✅ 기존 중앙정렬 레이아웃 유지(마크업 큰 틀 유지)
// ✅ 핵심 메시지(임상시험 Data Management 업무 절차 설계/관리 지원) 반영
// ✅ 커버 느낌을 위한 배경/강조 카드만 추가

import Link from "next/link"; // Next.js Link

export default function HomePage() {
  return (
    // ✅ 기존 구조 유지 + 배경 커버 처리
    <main className="relative h-full flex items-center justify-center px-6 overflow-hidden">
      {/* ✅ 커버 배경(다크/라이트 모두 자연스럽게) */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800" />
      {/* ✅ 은은한 패턴/광원 */}
      <div className="absolute inset-0 -z-10 opacity-35 [background:radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_38%),radial-gradient(circle_at_80%_25%,rgba(56,189,248,0.20),transparent_42%),radial-gradient(circle_at_50%_80%,rgba(168,85,247,0.18),transparent_45%)]" />

      {/* ✅ 기존 max-w-xl 유지 */}
      <div className="mx-auto w-full max-w-xl text-center">
        {/* ✅ 타이포만 커버 느낌으로 강화 */}
        <h1 className="text-4xl font-bold tracking-tight text-white">
          ProjNow
        </h1>

        {/* ✅ 요청하신 핵심 메시지로 교체 */}
        <p className="mt-5 text-base leading-relaxed text-white/80">
          ProjNow는 임상 시험에서 <span className="font-semibold text-white">Data Management</span> 영역의
          업무 절차를 <span className="font-semibold text-white">설계·관리</span>하여,
          더 <span className="font-semibold text-white">효율적</span>이고
          <span className="font-semibold text-white"> 정확한</span> 업무 수행을 지원하는 서비스입니다.
        </p>

        {/* ✅ 커버 느낌용 핵심 포인트(작은 카드 3개) */}
        <div className="mt-8 grid gap-3 sm:grid-cols-3 text-left">
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-sm font-semibold text-white">절차 설계</div>
            <div className="mt-1 text-xs text-white/70">
              SOP/Workflow 기반 구조화
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-sm font-semibold text-white">정확성</div>
            <div className="mt-1 text-xs text-white/70">
              정합성·검증 중심 품질
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-sm font-semibold text-white">추적성</div>
            <div className="mt-1 text-xs text-white/70">
              변경 이력·근거 관리
            </div>
          </div>
        </div>

        {/* ✅ 기존 시작하기 링크 유지(스타일만 커버톤으로 조정) */}
        <div className="mt-10">
          <Link
            href="/contents"
            className="inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-white/90"
          >
            시작하기
          </Link>
        </div>

        {/* ✅ 작은 보조 문구(선택) */}
        <div className="mt-4 text-xs text-white/60">
          Define → Execute → Control 흐름으로 DM 업무를 일관되게 관리합니다.
        </div>
      </div>
    </main>
  );
}
