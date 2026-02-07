// app/contents/page.tsx
// - /contents 메인(네비게이션/설명) 화면
// - 좌측: 클릭 가능한 메뉴 카드 목록
// - 우측: 선택한 메뉴에 대한 설명 + "페이지로 이동" 버튼

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 메뉴 정의 타입
 */
type MenuItem = {
  id: string; // 내부 식별자
  title: string; // 카드 제목
  href: string; // 이동 경로
  summary: string; // 카드 요약
  description: string[]; // 우측 설명(문단 배열)
  notes?: string[]; // 우측 참고(불릿)
};

export default function ContentsHome() {
  const router = useRouter();

  /**
   * ✅ 이 페이지는 "설명 페이지" 성격입니다.
   * - 사용자가 좌측 카드에서 메뉴를 선택하면, 우측에 설명을 보여주고 이동 버튼으로 진입합니다.
   * - 이 목록은 "노출해도 되는 메뉴"만 유지하세요.
   */
  const menuItems: MenuItem[] = useMemo(
    () => [
      {
        id: "workspace",
        title: "Workspace",
        href: "/workspace",
        summary: "작업 공간(프로젝트/업무 진입)",
        description: [
          "프로젝트 단위로 작업을 진행하는 기본 진입점입니다.",
          "이 페이지에서는 기능의 목적과 사용 흐름을 빠르게 파악할 수 있도록 안내합니다.",
        ],
        notes: ["프로젝트 목록/생성/참여자 관리 등의 흐름을 여기서 시작합니다."],
      },
      {
        id: "convert",
        title: "Data Convert",
        href: "/contents/convert",
        summary: "파일 변환(Excel/CSV/TXT/JSON 등)",
        description: [
          "업로드한 데이터를 원하는 포맷으로 변환하는 기능입니다.",
          "변환 결과를 다운로드하거나, 표 형태로 확인하는 흐름을 제공합니다.",
        ],
        notes: ["변환/다운로드의 기본 동선은 좌측 메뉴 이동을 기준으로 합니다."],
      },
      {
        id: "compare",
        title: "Compare",
        href: "/contents/compare",
        summary: "데이터 비교(원본 vs 변환본)",
        description: [
          "두 파일(또는 두 데이터셋)을 비교하여 추가/삭제/변경된 항목을 확인합니다.",
          "대량 데이터는 엑셀 다운로드 등으로 확인하는 흐름을 권장합니다.",
        ],
        notes: ["비교 기준 키/열 구성은 화면 내 안내 기준을 따릅니다."],
      },
      {
        id: "crf",
        title: "CRF",
        href: "/contents/crf",
        summary: "CRF 폼 구성/관리",
        description: [
          "CRF(Form) 구조를 구성하고 관리하는 메뉴입니다.",
          "폼 단위로 항목을 정리하고, 표준 변수명(예: SDTM 관례)을 반영하는 방식으로 활용합니다.",
        ],
        notes: ["구조 변경 시 저장/엑셀 다운로드 등의 기능 흐름을 제공합니다."],
      },
      {
        id: "econtents",
        title: "eContents",
        href: "/contents/econtents",
        summary: "폼 콘텐츠(항목/변수) 관리",
        description: [
          "폼과 연동되는 콘텐츠(변수명/설명/규칙 등)를 관리하는 메뉴입니다.",
          "엑셀 업로드로 수정/추가를 반영하는 방식의 운영을 지원합니다.",
        ],
        notes: ["업로드 시 덮어쓰기 여부 등 주의 문구를 확인하세요."],
      },
      {
        id: "visit",
        title: "Visit",
        href: "/contents/visit",
        summary: "방문 스케줄/방문 구조 관리",
        description: [
          "스크리닝/베이스라인 등 Visit 구조를 정의하고 관리합니다.",
          "프로토콜 기반으로 방문 흐름을 표준화하는 용도로 사용합니다.",
        ],
      },
      {
        id: "manageStructureTemplates",
        title: "Manage Structure Templates",
        href: "/contents/manage_structure_templates",
        summary: "구조 템플릿 업로드/참고 콘텐츠",
        description: [
          "구조 템플릿(참고용 컨텐츠)을 업로드하여 메뉴 내에서 참고/활용하는 기능입니다.",
          "다른 메뉴에서 가져오는 방식이 아니라, 이 메뉴 내부에서 참고 컨텐츠를 생성/관리하는 목적입니다.",
        ],
      },
    ],
    []
  );

  /**
   * ✅ 기본 선택 메뉴
   */
  const [selectedId, setSelectedId] = useState<string>(menuItems[0]?.id ?? "");

  const selected = useMemo(
    () => menuItems.find((m) => m.id === selectedId) ?? menuItems[0],
    [menuItems, selectedId]
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ProjNow Dashboard</h1>

      <p className="text-sm text-black/70 dark:text-white/70">
        이 페이지는 <span className="font-semibold">메뉴 안내(설명)</span>를 위한 네비게이션 페이지입니다.
        실제 페이지 이동의 기본 동선은 <span className="font-semibold">좌측 사이드바</span>를 기준으로 동작합니다.
      </p>

      {/* ✅ 좌: 메뉴 카드 / 우: 설명 패널 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 좌측 메뉴 카드 */}
        <div className="lg:col-span-5 xl:col-span-4">
          <div className="space-y-3">
            {menuItems.map((item) => {
              const isActive = item.id === selectedId;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={[
                    "w-full text-left rounded-2xl border p-5 transition",
                    "hover:bg-black/5 dark:hover:bg-white/5",
                    isActive
                      ? "border-black/30 dark:border-white/30 bg-black/5 dark:bg-white/5"
                      : "border-black/10 dark:border-white/10",
                  ].join(" ")}
                >
                  <div className="text-base font-semibold">{item.title}</div>
                  <div className="mt-2 text-sm text-black/70 dark:text-white/70">{item.summary}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 우측 설명 패널 */}
        <div className="lg:col-span-7 xl:col-span-8">
          <div className="rounded-2xl border border-black/10 dark:border-white/10 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-lg font-bold">{selected?.title}</div>
                <div className="mt-1 text-sm text-black/70 dark:text-white/70">{selected?.summary}</div>
              </div>

              <button
                type="button"
                onClick={() => {
                  // ✅ 선택된 메뉴로 이동
                  if (selected?.href) router.push(selected.href);
                }}
                className="rounded-xl border border-black/20 dark:border-white/20 px-4 py-2 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/5"
              >
                페이지로 이동
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {selected?.description?.map((p, idx) => (
                <p key={idx} className="text-sm leading-6 text-black/80 dark:text-white/80">
                  {p}
                </p>
              ))}

              {selected?.notes && selected.notes.length > 0 && (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-black/75 dark:text-white/75">
                  {selected.notes.map((n, idx) => (
                    <li key={idx}>{n}</li>
                  ))}
                </ul>
              )}

              <div className="mt-5 text-xs text-black/60 dark:text-white/60">
                경로: <span className="font-mono">{selected?.href}</span>
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs text-black/60 dark:text-white/60">
            ※ 이 화면은 메뉴의 목적과 사용 흐름을 간단히 안내합니다.
          </p>
        </div>
      </div>
    </div>
  );
}
