// components/AppFooter.tsx
"use client";

/**
 * components/AppFooter.tsx
 * - 전역 Footer
 * 요구사항:
 * 1) /contents에서는 좌측 메뉴(사이드바) 배경이 footer까지 이어져 보이게
 * 2) footer는 "이용약관 / 개인정보처리방침"만 가운데 정렬
 * 3) 선(보더) 중복/코너 두꺼움 최소화
 *
 * 구현:
 * - /contents에서는 footer를 2컬럼으로 분리 (좌측 w-64 + 우측 flex-1)
 * - 좌측 w-64는 Sidebar와 동일한 그라데이션으로 "연장"처럼 보이게 처리
 * - footer의 상단선(border-t)은 기본적으로 유지하되,
 *   좌측 w-64 영역 위쪽에는 별도 상단선이 겹치지 않도록(시각적 단절 방지) 처리
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();

  // ✅ /contents 및 하위 경로에서만 "좌측 사이드바 영역 분리 Footer" 적용
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  // ✅ /contents 외: 일반 footer (가운데 정렬)
  if (!isContents) {
    return (
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="h-12 px-4 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
          <Link href="/contents/terms" className="hover:underline">
            이용약관
          </Link>
          <Link href="/contents/privacy" className="hover:underline">
            개인정보처리방침
          </Link>
        </div>
      </footer>
    );
  }

  // ✅ /contents 전용: 좌측 w-64는 사이드바 연장처럼 보이게 처리
  return (
    <footer className="border-t border-gray-800">
      <div className="flex">
        {/* ✅ 좌측: Sidebar 연장 배경
            - Footer 상단선이 좌측에서 "끊겨 보이는" 느낌을 만들 수 있어
              좌측은 시각적 단절이 덜하도록 별도 테두리/선은 두지 않습니다. */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* ✅ 우측: Footer 본문
            - 본문과 사이드바 경계선은 여기서만 1줄로 관리 */}
        <div className="flex-1 bg-white dark:bg-gray-900 border-l border-gray-800">
          <div className="h-12 px-4 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
            <Link href="/contents/terms" className="hover:underline">
              이용약관
            </Link>
            <Link href="/contents/privacy" className="hover:underline">
              개인정보처리방침
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
