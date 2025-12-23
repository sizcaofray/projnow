// app/contents/layout.tsx
// - /contents 하위 공통 레이아웃(최소 구성)
// - 추후 Sidebar/Topbar(로그인 버튼) 구조를 여기서 확장합니다.

import type { ReactNode } from "react";

export default function ContentsLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
