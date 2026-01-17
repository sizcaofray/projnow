// app/page.tsx
// ✅ 헤더/푸터를 제외한 "남은 영역"을 채우는 방식 (flex-1 + min-h-0)
// ✅ 배경색 강제하지 않음 (어떤 모드/테마에서도 자연스럽게)
// ✅ 과한 padding/고정 height 사용 금지 → 불필요 스크롤 최소화

import Link from "next/link"; // Next.js Link

export default function HomePage() {
  return (
    // ✅ 남은 영역 채우기(헤더/푸터가 있으면 자동으로 나머지)
    <main className="flex-1 min-h-0 w-full flex items-center justify-center px-6 py-8">
      {/* ✅ 내용은 카드 중심으로(배경 강제 없음) */}
      <section className="w-full max-w-3xl">
        {/* 상단 타이틀/메시지 */}
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            ProjNow
          </h1>

          <p className="mt-4 text-base leading-relaxed opacity-80">
            ProjNow는 임상 시험에서 <span className="font-semibold">Data Management</span> 영역의
            업무 절차를 <span className="font-semibold">설계·관리</span>하여,
            더 <span className="font-semibold">효율적</span>이고 <span className="font-semibold">정확한</span> 업무 수행을 지원하는 서비스입니다.
          </p>
        </div>

        {/* 핵심 카드 */}
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border p-5">
            <div className="text-sm font-semibold">절차 설계</div>
            <div className="mt-2 text-sm opacity-80">
              SOP/Workflow 기반으로 업무 단계를 구조화합니다.
            </div>
          </div>

          <div className="rounded-2xl border p-5">
            <div className="text-sm font-semibold">정확성</div>
            <div className="mt-2 text-sm opacity-80">
              정합성·검증 중심으로 오류를 줄이고 품질을 안정화합니다.
            </div>
          </div>

          <div className="rounded-2xl border p-5">
            <div className="text-sm font-semibold">추적성</div>
            <div className="mt-2 text-sm opacity-80">
              변경 이력·근거를 남겨 투명한 관리가 가능합니다.
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/contents"
            className="inline-flex items-center justify-center rounded-lg border px-6 py-3 text-sm font-semibold hover:opacity-90"
          >
            시작하기
          </Link>

          <Link
            href="/contents/datainfo"
            className="inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-semibold opacity-80 hover:opacity-100"
          >
            기능 둘러보기
          </Link>
        </div>

        {/* 보조 문구 */}
        <div className="mt-5 text-center text-xs opacity-70">
          Define → Execute → Control 흐름으로 Data Management 업무를 일관되게 관리합니다.
        </div>
      </section>
    </main>
  );
}
