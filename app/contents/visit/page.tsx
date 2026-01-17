// app/contents/visit/page.tsx
// 방문(Visit) 정의 페이지
// - CRF 입력 메뉴와 유사하게 "행 단위 입력" + 목록 테이블 형태로 구성
// - Firestore: trials/{trialId}/visits/{visitId} 에 저장
// - 다른 메뉴에서 trialId 기반으로 재사용 가능

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ✅ 프로젝트에 이미 존재하는 Firebase 초기화 모듈 경로로 교체하세요.
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

// Firebase
import {
  onAuthStateChanged,
  User as FirebaseUser,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

// ✅ Visit 타입 정의
type VisitRow = {
  id: string;
  visitCode: string;
  visitName: string;
  visitNo: number | null;
  targetDay: number | null;
  windowMin: number | null;
  windowMax: number | null;
  isActive: boolean;
  order: number;
  note: string;
};

type VisitDraft = Omit<VisitRow, "id">;

const emptyDraft = (): VisitDraft => ({
  visitCode: "",
  visitName: "",
  visitNo: null,
  targetDay: null,
  windowMin: null,
  windowMax: null,
  isActive: true,
  order: 0,
  note: "",
});

export default function VisitPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ✅ trialId는 쿼리로 받는 것을 권장: /contents/visit?trialId=DW_DWP14012303
  const trialId = useMemo(() => {
    return searchParams.get("trialId")?.trim() || "default-trial";
  }, [searchParams]);

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  // 목록/입력 상태
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [draft, setDraft] = useState<VisitDraft>(emptyDraft());

  // 편집 상태
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<VisitDraft>(emptyDraft());

  // -----------------------------
  // ✅ 로그인 보호 (비로그인시 "/" 리다이렉트)
  // -----------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.replace("/");
        return;
      }
      setUser(u);
      setLoading(false);
    });

    return () => unsub();
  }, [router]);

  // -----------------------------
  // ✅ 방문 목록 로드
  // -----------------------------
  const loadVisits = async () => {
    if (!user) return;

    // trials/{trialId}/visits
    const colRef = collection(db, "trials", trialId, "visits");
    const q = query(colRef, orderBy("order", "asc"));

    const snap = await getDocs(q);
    const list: VisitRow[] = snap.docs.map((d) => {
      const v = d.data() as any;
      return {
        id: d.id,
        visitCode: v.visitCode ?? "",
        visitName: v.visitName ?? "",
        visitNo: typeof v.visitNo === "number" ? v.visitNo : null,
        targetDay: typeof v.targetDay === "number" ? v.targetDay : null,
        windowMin: typeof v.windowMin === "number" ? v.windowMin : null,
        windowMax: typeof v.windowMax === "number" ? v.windowMax : null,
        isActive: v.isActive ?? true,
        order: typeof v.order === "number" ? v.order : 0,
        note: v.note ?? "",
      };
    });

    setRows(list);

    // ✅ 신규 입력 draft의 order는 마지막 + 1로 기본 설정
    const nextOrder = list.length ? Math.max(...list.map((x) => x.order)) + 1 : 1;
    setDraft((prev) => ({ ...prev, order: nextOrder }));
  };

  useEffect(() => {
    if (!user) return;
    loadVisits().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, trialId]);

  // -----------------------------
  // ✅ 숫자 입력 파서(빈값 -> null)
  // -----------------------------
  const toNumberOrNull = (val: string) => {
    const t = val.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  // -----------------------------
  // ✅ 추가(Create)
  // -----------------------------
  const onAdd = async () => {
    if (!user) return;

    // 최소 필수값 체크 (CRF처럼 너무 빡세지 않게)
    if (!draft.visitCode.trim() || !draft.visitName.trim()) {
      alert("Visit Code / Visit Name은 필수입니다.");
      return;
    }

    const colRef = collection(db, "trials", trialId, "visits");
    await addDoc(colRef, {
      ...draft,
      visitCode: draft.visitCode.trim(),
      visitName: draft.visitName.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      // ✅ 추후 다른 메뉴에서 사용자 확인이 필요하면 유지
      ownerUid: user.uid,
    });

    // ✅ 입력 폼 초기화(다음 order 자동 증가)
    const nextOrder = rows.length ? Math.max(...rows.map((x) => x.order)) + 1 : 1;
    setDraft({ ...emptyDraft(), order: nextOrder });

    await loadVisits();
  };

  // -----------------------------
  // ✅ 편집 시작
  // -----------------------------
  const startEdit = (r: VisitRow) => {
    setEditId(r.id);
    setEditDraft({
      visitCode: r.visitCode,
      visitName: r.visitName,
      visitNo: r.visitNo,
      targetDay: r.targetDay,
      windowMin: r.windowMin,
      windowMax: r.windowMax,
      isActive: r.isActive,
      order: r.order,
      note: r.note,
    });
  };

  // -----------------------------
  // ✅ 편집 저장(Update)
  // -----------------------------
  const saveEdit = async () => {
    if (!user || !editId) return;

    if (!editDraft.visitCode.trim() || !editDraft.visitName.trim()) {
      alert("Visit Code / Visit Name은 필수입니다.");
      return;
    }

    const docRef = doc(db, "trials", trialId, "visits", editId);
    await updateDoc(docRef, {
      ...editDraft,
      visitCode: editDraft.visitCode.trim(),
      visitName: editDraft.visitName.trim(),
      updatedAt: serverTimestamp(),
    });

    setEditId(null);
    await loadVisits();
  };

  // -----------------------------
  // ✅ 편집 취소
  // -----------------------------
  const cancelEdit = () => {
    setEditId(null);
    setEditDraft(emptyDraft());
  };

  // -----------------------------
  // ✅ 삭제(Delete)
  // -----------------------------
  const onDelete = async (id: string) => {
    if (!user) return;

    const ok = confirm("해당 Visit을 삭제하시겠습니까?");
    if (!ok) return;

    await deleteDoc(doc(db, "trials", trialId, "visits", id));
    await loadVisits();
  };

  // -----------------------------
  // ✅ 순서 이동(Up/Down) - 라이브러리 없이 안정적으로 구현
  // - 필요 시 이후 CRF처럼 Drag&Drop으로 교체 가능
  // -----------------------------
  const moveRow = async (id: string, dir: "up" | "down") => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return;

    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return;

    const a = rows[idx];
    const b = rows[swapIdx];

    // order만 서로 교환
    await updateDoc(doc(db, "trials", trialId, "visits", a.id), {
      order: b.order,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "trials", trialId, "visits", b.id), {
      order: a.order,
      updatedAt: serverTimestamp(),
    });

    await loadVisits();
  };

  if (loading) {
    return (
      <main className="p-6">
        <div className="text-sm opacity-70">로딩 중...</div>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-6">
      {/* ✅ 헤더 */}
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">Visit 정의</h1>

        {/* ✅ trialId 안내: 이후 메뉴들이 trialId로 Visit을 참조 */}
        <div className="text-sm opacity-80">
          Trial ID: <span className="font-mono">{trialId}</span>
          <span className="ml-2 opacity-70">
            (권장: <span className="font-mono">/contents/visit?trialId=...</span>)
          </span>
        </div>
      </div>

      {/* ✅ CRF처럼 “행 입력” 영역 */}
      <section className="rounded-lg border p-4 space-y-3">
        <div className="font-semibold">새 Visit 추가</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Visit Code */}
          <label className="text-sm">
            <div className="mb-1 opacity-80">Visit Code *</div>
            <input
              className="w-full rounded border px-3 py-2 bg-transparent"
              value={draft.visitCode}
              onChange={(e) =>
                setDraft((p) => ({ ...p, visitCode: e.target.value }))
              }
              placeholder="예: SCR / BASE / V01 / WK04"
            />
          </label>

          {/* Visit Name */}
          <label className="text-sm md:col-span-2">
            <div className="mb-1 opacity-80">Visit Name *</div>
            <input
              className="w-full rounded border px-3 py-2 bg-transparent"
              value={draft.visitName}
              onChange={(e) =>
                setDraft((p) => ({ ...p, visitName: e.target.value }))
              }
              placeholder="예: Screening / Baseline / Week 4"
            />
          </label>

          {/* visitNo */}
          <label className="text-sm">
            <div className="mb-1 opacity-80">Visit No</div>
            <input
              className="w-full rounded border px-3 py-2 bg-transparent"
              value={draft.visitNo ?? ""}
              onChange={(e) =>
                setDraft((p) => ({ ...p, visitNo: toNumberOrNull(e.target.value) }))
              }
              placeholder="예: 1"
            />
          </label>

          {/* targetDay */}
          <label className="text-sm">
            <div className="mb-1 opacity-80">Target Day</div>
            <input
              className="w-full rounded border px-3 py-2 bg-transparent"
              value={draft.targetDay ?? ""}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  targetDay: toNumberOrNull(e.target.value),
                }))
              }
              placeholder="예: 1 / 28"
            />
          </label>

          {/* Window */}
          <label className="text-sm">
            <div className="mb-1 opacity-80">Window (min / max)</div>
            <div className="flex gap-2">
              <input
                className="w-full rounded border px-3 py-2 bg-transparent"
                value={draft.windowMin ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    windowMin: toNumberOrNull(e.target.value),
                  }))
                }
                placeholder="-3"
              />
              <input
                className="w-full rounded border px-3 py-2 bg-transparent"
                value={draft.windowMax ?? ""}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    windowMax: toNumberOrNull(e.target.value),
                  }))
                }
                placeholder="+3"
              />
            </div>
          </label>

          {/* isActive */}
          <label className="text-sm">
            <div className="mb-1 opacity-80">Active</div>
            <select
              className="w-full rounded border px-3 py-2 bg-transparent"
              value={draft.isActive ? "true" : "false"}
              onChange={(e) =>
                setDraft((p) => ({ ...p, isActive: e.target.value === "true" }))
              }
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>

          {/* order */}
          <label className="text-sm">
            <div className="mb-1 opacity-80">Order</div>
            <input
              className="w-full rounded border px-3 py-2 bg-transparent"
              value={draft.order}
              onChange={(e) =>
                setDraft((p) => ({
                  ...p,
                  order: Number(e.target.value || 0),
                }))
              }
              placeholder="예: 10"
            />
          </label>

          {/* note */}
          <label className="text-sm md:col-span-2">
            <div className="mb-1 opacity-80">Note</div>
            <input
              className="w-full rounded border px-3 py-2 bg-transparent"
              value={draft.note}
              onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))}
              placeholder="메모"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded border px-4 py-2"
            onClick={onAdd}
          >
            + Visit 추가
          </button>
          <button
            className="rounded border px-4 py-2 opacity-80"
            onClick={() => setDraft((p) => ({ ...emptyDraft(), order: p.order }))}
          >
            입력 초기화
          </button>
        </div>
      </section>

      {/* ✅ 목록 테이블 */}
      <section className="rounded-lg border p-4 space-y-3">
        <div className="font-semibold">Visit 목록</div>

        <div className="overflow-auto">
          <table className="min-w-[980px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Order</th>
                <th className="text-left p-2">Visit Code</th>
                <th className="text-left p-2">Visit Name</th>
                <th className="text-left p-2">No</th>
                <th className="text-left p-2">TargetDay</th>
                <th className="text-left p-2">Window</th>
                <th className="text-left p-2">Active</th>
                <th className="text-left p-2">Note</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => {
                const isEdit = editId === r.id;

                return (
                  <tr key={r.id} className="border-b">
                    {/* Order */}
                    <td className="p-2 align-top">
                      {isEdit ? (
                        <input
                          className="w-20 rounded border px-2 py-1 bg-transparent"
                          value={editDraft.order}
                          onChange={(e) =>
                            setEditDraft((p) => ({
                              ...p,
                              order: Number(e.target.value || 0),
                            }))
                          }
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{r.order}</span>
                          <div className="flex gap-1">
                            <button
                              className="rounded border px-2 py-1"
                              onClick={() => moveRow(r.id, "up")}
                              title="위로"
                            >
                              ↑
                            </button>
                            <button
                              className="rounded border px-2 py-1"
                              onClick={() => moveRow(r.id, "down")}
                              title="아래로"
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Visit Code */}
                    <td className="p-2 align-top">
                      {isEdit ? (
                        <input
                          className="w-32 rounded border px-2 py-1 bg-transparent"
                          value={editDraft.visitCode}
                          onChange={(e) =>
                            setEditDraft((p) => ({
                              ...p,
                              visitCode: e.target.value,
                            }))
                          }
                        />
                      ) : (
                        <span className="font-mono">{r.visitCode}</span>
                      )}
                    </td>

                    {/* Visit Name */}
                    <td className="p-2 align-top">
                      {isEdit ? (
                        <input
                          className="w-[280px] rounded border px-2 py-1 bg-transparent"
                          value={editDraft.visitName}
                          onChange={(e) =>
                            setEditDraft((p) => ({
                              ...p,
                              visitName: e.target.value,
                            }))
                          }
                        />
                      ) : (
                        r.visitName
                      )}
                    </td>

                    {/* No */}
                    <td className="p-2 align-top">
                      {isEdit ? (
                        <input
                          className="w-20 rounded border px-2 py-1 bg-transparent"
                          value={editDraft.visitNo ?? ""}
                          onChange={(e) =>
                            setEditDraft((p) => ({
                              ...p,
                              visitNo: toNumberOrNull(e.target.value),
                            }))
                          }
                        />
                      ) : (
                        r.visitNo ?? "-"
                      )}
                    </td>

                    {/* TargetDay */}
                    <td className="p-2 align-top">
                      {isEdit ? (
                        <input
                          className="w-24 rounded border px-2 py-1 bg-transparent"
                          value={editDraft.targetDay ?? ""}
                          onChange={(e) =>
                            setEditDraft((p) => ({
                              ...p,
                              targetDay: toNumberOrNull(e.target.value),
                            }))
                          }
                        />
                      ) : (
                        r.targetDay ?? "-"
                      )}
                    </td>

                    {/* Window */}
                    <td className="p-2 align-top">
                      {isEdit ? (
                        <div className="flex gap-2">
                          <input
                            className="w-20 rounded border px-2 py-1 bg-transparent"
                            value={editDraft.windowMin ?? ""}
                            onChange={(e) =>
                              setEditDraft((p) => ({
                                ...p,
                                windowMin: toNumberOrNull(e.target.value),
                              }))
                            }
                            placeholder="-"
                          />
                          <input
                            className="w-20 rounded border px-2 py-1 bg-transparent"
                            value={editDraft.windowMax ?? ""}
                            onChange={(e) =>
                              setEditDraft((p) => ({
                                ...p,
                                windowMax: toNumberOrNull(e.target.value),
                              }))
                            }
                            placeholder="+"
                          />
                        </div>
                      ) : (
                        <span>
                          {r.windowMin ?? "-"} / {r.windowMax ?? "-"}
                        </span>
                      )}
                    </td>

                    {/* Active */}
                    <td className="p-2 align-top">
                      {isEdit ? (
                        <select
                          className="rounded border px-2 py-1 bg-transparent"
                          value={editDraft.isActive ? "true" : "false"}
                          onChange={(e) =>
                            setEditDraft((p) => ({
                              ...p,
                              isActive: e.target.value === "true",
                            }))
                          }
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        String(r.isActive)
                      )}
                    </td>

                    {/* Note */}
                    <td className="p-2 align-top">
                      {isEdit ? (
                        <input
                          className="w-[220px] rounded border px-2 py-1 bg-transparent"
                          value={editDraft.note}
                          onChange={(e) =>
                            setEditDraft((p) => ({ ...p, note: e.target.value }))
                          }
                        />
                      ) : (
                        r.note || "-"
                      )}
                    </td>

                    {/* Actions */}
                    <td className="p-2 align-top">
                      {isEdit ? (
                        <div className="flex gap-2">
                          <button
                            className="rounded border px-3 py-1"
                            onClick={saveEdit}
                          >
                            저장
                          </button>
                          <button
                            className="rounded border px-3 py-1 opacity-80"
                            onClick={cancelEdit}
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            className="rounded border px-3 py-1"
                            onClick={() => startEdit(r)}
                          >
                            수정
                          </button>
                          <button
                            className="rounded border px-3 py-1"
                            onClick={() => onDelete(r.id)}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!rows.length && (
                <tr>
                  <td className="p-3 opacity-70" colSpan={9}>
                    아직 등록된 Visit이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
