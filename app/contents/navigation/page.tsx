"use client";

/**
 * 📄 app/contents/navigation/page.tsx
 * - Next.js App Router page는 반드시 "export default" 컴포넌트를 가져야 합니다.
 * - 본 파일이 export/import가 없는 상태면 TS가 "is not a module" 에러를 냅니다.
 * - 현재는 최소 동작 화면(placeholder)만 제공합니다.
 */

import React from "react";

export default function NavigationPage() {
  return (
    <main className="p-6 space-y-2">
      <h1 className="text-xl font-semibold">Navigation</h1>
      <p className="text-sm opacity-70">
        Navigation 관리 화면(구현 예정)
      </p>
    </main>
  );
}
