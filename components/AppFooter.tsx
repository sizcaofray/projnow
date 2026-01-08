// components/AppFooter.tsx
"use client";

/**
 * ✅ 요구사항(메인 /contents 기준)
 * 1) 좌측 메뉴 디자인이 푸터 영역(좌측 64px)까지 이어져 보이게
 * 2) 푸터 텍스트/정렬은 영향을 받지 않게(오른쪽 영역만 가운데)
 * 3) 첫 페이지(커버)에는 좌측 메뉴영역 없이 일반 푸터만
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();

  // ✅ /contents 하위인지 판별 (사이드바가 있는 화면)
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  // ✅ 공통 footer 스타일
  const baseClass = "shrink-0 h-12 border-t border-gray-800";

  // ✅ 커버/일반 페이지: 좌측 영역 없이 중앙 정렬
  if (!isContents) {
    return (
      <footer className={`${baseClass} bg-black`}>
        <div className="h-full px-4 flex items-center justify-center gap-6 text-sm text-gray-300">
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

  // ✅ /contents: 좌측 64px를 "사이드바와 동일 톤"으로 이어 보이게만 처리
  // - 여기서 메뉴가 내려오는 게 아니라, 배경만 이어져 보이게 하는 방식입니다.
  return (
    <footer className={baseClass}>
      <div className="flex h-full">
        {/* 🔥 핵심: sidebar와 동일한 그라데이션 */}
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800" />

        {/* ✅ 푸터 본문(영향 X): 항상 가운데 */}
        <div className="flex-1 bg-black flex items-center justify-center gap-6 text-sm text-gray-300">
          <Link href="/contents/terms" className="hover:underline">
            이용약관
          </Link>
          <Link href="/contents/privacy" className="hover:underline">
            개인정보처리방침
          </Link>
        </div>
      </div>
    </footer>
  );
}
