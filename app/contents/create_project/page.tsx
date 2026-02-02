"use client";

// app/contents/create_project/page.tsx
// Project(최상위 단위) 생성/수정/삭제 UI
// - UID는 PRJ_000001 형태로 자동 생성됩니다.
// - 삭제는 confirm으로 재확인합니다.
// - 현재는 "owner(생성자)" 프로젝트만 표시합니다. (3번 초대 기능은 다음 단계에서 확장)

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase/firebase"; // ✅ 현재 프로젝트 경로 기준

type ProjectDoc = {
  uid: string; // PRJ_000001
  name: string;
  ownerUid: string;
  ownerEmail: string;
  createdAt?: any;
  updatedAt?: any;
};

function pad6(n: number) {
  // PRJ_000001 형태(6자리 padding)
  const s = String(n);
  return s.length >= 6 ? s : "0".repeat(6 - s.length) + s;
}

export default function CreateProjectPage() {
  const [userUid, setUserUid] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // 생성 입력
  const [newName, setNewName] = useState("");

  // 인라인 편집 상태
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");

  // 로그인 상태 추적
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUserUid(null);
        setUserEmail(null);
        setProjects([]);
        setLoading(false);
        return;
      }
      setUserUid(u.uid);
      setUserEmail(u.email ?? "");
    });

    return () => unsub();
  }, []);

  // 내 프로젝트 목록 구독(실시간)
  // ⚠️ where + orderBy 조합은 Firestore 인덱스 요구가 생길 수 있어,
  //    우선 where만 사용하고 UI에서 정렬하는 방식으로 처리합니다.
  useEffect(() => {
    if (!userUid) return;

    setLoading(true);

    const q = query(collection(db, "projects"), where("ownerUid", "==", userUid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as ProjectDoc);

        // createdAt 기준 최신순 정렬(서버 timestamp이므로 없을 수 있어 방어)
        rows.sort((a, b) => {
          const at = a.createdAt?.toMillis?.() ?? 0;
          const bt = b.createdAt?.toMillis?.() ?? 0;
          return bt - at;
        });

        setProjects(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [userUid]);

  const canCreate = useMemo(() => {
    return !!userUid && !!userEmail && newName.trim().length > 0;
  }, [userUid, userEmail, newName]);

  // 1) 프로젝트 생성 (PRJ_000001 자동 생성)
  const createProject = async () => {
    if (!canCreate) return;

    const name = newName.trim();

    try {
      await runTransaction(db, async (tx) => {
        // counters/projects 문서를 트랜잭션으로 증가시키고,
        // 증가된 값으로 PRJ_000001 형태를 만든 뒤 projects/{uid} 생성합니다.
        const counterRef = doc(db, "counters", "projects");
        const counterSnap = await tx.get(counterRef);

        const last = counterSnap.exists() ? Number(counterSnap.data().last ?? 0) : 0;
        const next = last + 1;

        // 카운터 업데이트(없으면 생성)
        tx.set(counterRef, { last: next }, { merge: true });

        const uid = `PRJ_${pad6(next)}`;
        const projectRef = doc(db, "projects", uid);

        const existing = await tx.get(projectRef);
        if (existing.exists()) {
          throw new Error("이미 존재하는 프로젝트 UID입니다. 다시 시도해주세요.");
        }

        tx.set(projectRef, {
          uid,
          name,
          ownerUid: userUid,
          ownerEmail: userEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      setNewName("");
    } catch (e: any) {
      alert(e?.message ?? "프로젝트 생성 중 오류가 발생했습니다.");
    }
  };

  // 2) 프로젝트명 수정
  const saveName = async (uid: string) => {
    const name = editingName.trim();
    if (!name) {
      alert("프로젝트명을 입력해주세요.");
      return;
    }

    try {
      await updateDoc(doc(db, "projects", uid), {
        name,
        updatedAt: serverTimestamp(),
      });

      setEditingUid(null);
      setEditingName("");
    } catch (e: any) {
      alert(e?.message ?? "프로젝트명 수정 중 오류가 발생했습니다.");
    }
  };

  // 2) 프로젝트 삭제(confirm 필수)
  const removeProject = async (uid: string) => {
    const ok = window.confirm(
      `정말 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.\n\n대상: ${uid}`
    );
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "projects", uid));
    } catch (e: any) {
      alert(e?.message ?? "프로젝트 삭제 중 오류가 발생했습니다.");
    }
  };

  if (!userUid) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-bold mb-2">Create Project</h1>
        <p className="text-sm opacity-80">로그인 후 이용 가능합니다.</p>
      </main>
    );
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Project 생성/관리</h1>
        <p className="text-sm opacity-80">
          프로젝트는 이후 모든 하위 메뉴를 묶는 최상위 단위입니다.
        </p>
      </div>

      {/* 생성 영역 */}
      <section className="border rounded-md p-4 mb-6">
        <h2 className="font-semibold mb-3">새 Project 생성</h2>

        <div className="flex gap-2 items-center">
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="Project 명을 입력하세요"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="border rounded px-4 py-2"
            onClick={createProject}
            disabled={!canCreate}
            title={!canCreate ? "프로젝트명을 입력해주세요." : "생성"}
          >
            생성
          </button>
        </div>

        <p className="text-xs opacity-70 mt-2">
          생성 시 UID는 <code>PRJ_000001</code> 형태로 자동 부여됩니다.
        </p>
      </section>

      {/* 목록 */}
      <section className="border rounded-md p-4">
        <h2 className="font-semibold mb-3">내 Project 목록</h2>

        {loading ? (
          <p className="text-sm opacity-80">불러오는 중...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm opacity-80">생성된 프로젝트가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => {
              const isEditing = editingUid === p.uid;

              return (
                <div key={p.uid} className="border rounded-md p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm w-full">
                      <div className="font-semibold">{p.uid}</div>

                      {!isEditing ? (
                        <div className="opacity-90">{p.name}</div>
                      ) : (
                        <input
                          className="border rounded px-3 py-2 w-full mt-2"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          placeholder="새 Project 명"
                        />
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {!isEditing ? (
                        <>
                          <button
                            className="border rounded px-3 py-2"
                            onClick={() => {
                              setEditingUid(p.uid);
                              setEditingName(p.name);
                            }}
                            title="프로젝트명 수정"
                          >
                            수정
                          </button>
                          <button
                            className="border rounded px-3 py-2"
                            onClick={() => removeProject(p.uid)}
                            title="프로젝트 삭제"
                          >
                            삭제
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="border rounded px-3 py-2"
                            onClick={() => saveName(p.uid)}
                            title="저장"
                          >
                            저장
                          </button>
                          <button
                            className="border rounded px-3 py-2"
                            onClick={() => {
                              setEditingUid(null);
                              setEditingName("");
                            }}
                            title="취소"
                          >
                            취소
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-xs opacity-70">Owner: {p.ownerEmail}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
