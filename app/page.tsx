// app/page.tsx
// ✅ 창 크기 자동 대응 (크기 강제 X)
// ✅ 불필요한 스크롤 방지 (과한 padding/고정 height 지양)
// ✅ 다크/라이트 모드 영향 없음 (색상 고정)

import Link from "next/link"; // Next.js Link

export default function HomePage() {
  return (
    // ✅ min-h-dvh: 뷰포트 높이를 “최소”로만 채움(강제 고정 X)
    <main className="relative min-h-dvh w-full flex items-center justify-center px-6">
      {/* ✅ 배경은 화면 전체 채움(콘텐츠 높이와 무관) */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800" />
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-35 [background:radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_38%),radial-gradient(circle_at_80%_25%,rgba(56,189,248,0.20),transparent_42%),radial-gradient(circle_at_50%_80%,rgba(168,85,247,0.18),transparent_45%)]" />

      {/* ✅ 콘텐츠: 높이/크기 강제 없이 자연스럽게 */}
      <div className="mx-auto w-full max-w-xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white">ProjNow</h1>

        <p className="mt-5 text-base leading-relaxed text-white/80">
          ProjNow는 임상 시험에서{" "}
          <span className="font-semibold text-white">Data Management</span> 영역의
          업무 절차를 <span className="font-semibold text-white">설계·관리</span>하여,
          더 <span className="font-semibold text-white">효율적</span>이고{" "}
          <span className="font-semibold text-white">정확한</span> 업무 수행을 지원하는 서비스입니다.
        </p>

        {/* ✅ 카드: 높이 늘리지 않게 컴팩트하게 */}
        <div className="mt-7 grid gap-3 sm:grid-cols-3 text-left">
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-sm font-semibold text-white">절차 설계</div>
            <div className="mt-1 text-xs text-white/70">SOP/Workflow 기반 구조화</div>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-sm font-semibold text-white">정확성</div>
            <div className="mt-1 text-xs text-white/70">정합성·검증 중심 품질</div>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <div className="text-sm font-semibold text-white">추적성</div>
            <div className="mt-1 text-xs text-white/70">변경 이력·근거 관리</div>
          </div>
        </div>

        <div className="mt-8">
          <Link
            href="/contents"
            className="inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-white/90"
          >
            시작하기
          </Link>
        </div>

        <div className="mt-4 text-xs text-white/60">
          Define → Execute → Control 흐름으로 DM 업무를 일관되게 관리합니다.
        </div>
      </div>
    </main>
  );
}
