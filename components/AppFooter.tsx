// components/AppFooter.tsx
"use client";

// ✅ footer 좌측 배경이 사이드바와 겹쳐 보이는 문제 해결:
// - footer 좌측에 '짧은 그라데이션'이 다시 시작되면 경계가 두 번 칠해진 것처럼 보임
// - sidebar 하단색과 맞추기 위해 footer 좌측은 단색 bg-slate-800로 고정
// ✅ footer 세로선(border-l 등)은 추가하지 않음

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AppFooter() {
  const pathname = usePathname();
  const isContents = pathname === "/contents" || pathname.startsWith("/contents/");

  if (!isContents) {
    return (
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
        <div className="h-12 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
          <Link href="/contents/terms">이용약관</Link>
          <Link href="/contents/privacy">개인정보처리방침</Link>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-transparent">
      <div className="flex">
        {/* ✅ 좌측: sidebar "하단색"과 동일하게 단색 처리(겹침/이중 느낌 제거) */}
        <div className="w-64 bg-slate-800" />

        {/* 우측: footer 내용 (세로선 없음) */}
        <div className="flex-1 bg-white dark:bg-gray-900 border-t border-gray-800">
          <div className="h-12 flex items-center justify-center gap-6 text-sm text-gray-600 dark:text-gray-300">
            <Link href="/contents/terms">이용약관</Link>
            <Link href="/contents/privacy">개인정보처리방침</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
