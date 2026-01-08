// components/AppFooter.tsx
"use client";

/**
 * ✅ 목표
 * - Footer가 bg-black 같은 "강제 배경"을 가지지 않도록 수정
 * - 배경이 밝으면 글자 어둡게 / 배경이 어두우면 글자 밝게 (모드가 아니라 "화면 톤" 기준)
 * - /contents에서는 메인 영역 톤(예: 밝은 배경)을 따라가고,
 *   좌측 64px 영역만 사이드바 톤으로 이어지게 처리
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  // ✅ 공통: 푸터 높이/테두리만 유지 (배경/글씨는 아래에서 결정)
  const base = "shrink-0 h-12 border-t";

  // ✅ /contents가 아닌 페이지(커버 등): 기본은 밝은 바탕 + 어두운 글씨
  // (원하시면 이 부분을 해당 페이지 톤에 맞춰 별도로 바꾸면 됩니다.)
  if (!isContents) {
    return (
      <footer className={`${base} border-gray-200 bg-white text-slate-900`}>
        <div className="h-full px-4 flex items-center justify-center gap-6 text-sm">
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

  // ✅ /contents: "메인 배경"을 따라가게(예: 밝은 배경)
  // - 좌측 64px은 사이드바 톤으로만 이어 보이게 (푸터가 사이드바에 영향을 주지 않음)
  return (
    <footer className={`${base} border-gray-200 bg-white text-slate-900`}>
      <div className="flex h-full">
           {/* 오른쪽: 메인과 동일 톤 */}
        <div className="flex-1 flex items-center justify-center gap-6 text-sm">
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
