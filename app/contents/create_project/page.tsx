"use client";

// app/contents/create_project/page.tsx
// ✅ Project 생성/관리 화면
// - Project 생성 (PRJ_000001 자동 증가)
// - Project명 수정/삭제
// - 참여자 추가(이메일 기반) / 참여자 삭제
// - 오너 변경(Owner Transfer)
// ✅ 변경사항
// - 목록 조회: owner + member 기준으로 모두 조회
// - 편집 권한: owner인 프로젝트만 수정/삭제/참여자관리/오너변경 가능
// - member는 조회만 가능

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase/firebase";

type ProjectDoc = {
  uid: string;
  name: string;
  ownerUid: string;
  ownerEmail: string;
  members?: string[];
  createdAt?: any;
  updatedAt?: any;
};

type MemberProfile = {
  uid: string;
  email: string;
  name: string;
};

function pad6(n: number) {
  const s = String(n);
  return s.length >= 6 ? s : "0".repeat(6 - s.length) + s;
}

function normalizeEmail(v: string) {
  return (v ?? "").trim().toLowerCase();
}

function safeTrim(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function fallbackNameFromEmail(email: string) {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

function formatMember(email: string, name: string) {
  return `${email}(${name})`;
}

function sanitizeUids(arr: any): string[] {
  const src = Array.isArray(arr) ? arr : [];
  const cleaned = src
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  return Array.from(new Set(cleaned));
}

function sortProjects(rows: ProjectDoc[]) {
  return [...rows].sort((a, b) => {
    const at = a.createdAt?.toMillis?.() ?? 0;
    const bt = b.createdAt?.toMillis?.() ?? 0;
    return bt - at;
  });
}

export default function CreateProjectPage() {
  const [userUid, setUserUid] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState("");

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");

  const [inviteEmailByProject, setInviteEmailByProject] = useState<Record<string, string>>({});
  const [inviteLoadingByProject, setInviteLoadingByProject] = useState<Record<string, boolean>>(
    {}
  );

  const [removeLoadingKey, setRemoveLoadingKey] = useState<string>("");

  const [memberProfileByUid, setMemberProfileByUid] = useState<Record<string, MemberProfile>>({});

  const [newOwnerUidByProject, setNewOwnerUidByProject] = useState<Record<string, string>>({});
  const [ownerTransferLoadingKey, setOwnerTransferLoadingKey] = useState<string>("");

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
      setUserEmail(normalizeEmail(u.email ?? ""));
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!userUid) return;

    setLoading(true);

    const ownerQuery = query(collection(db, "projects"), where("ownerUid", "==", userUid));
    const memberQuery = query(collection(db, "projects"), where("members", "array-contains", userUid));

    let ownerRows: ProjectDoc[] = [];
    let memberRows: ProjectDoc[] = [];
    let ownerLoaded = false;
    let memberLoaded = false;

    const applyMerged = () => {
      const mergedMap = new Map<string, ProjectDoc>();

      [...ownerRows, ...memberRows].forEach((row) => {
        if (!row?.uid) return;
        mergedMap.set(row.uid, row);
      });

      setProjects(sortProjects(Array.from(mergedMap.values())));

      if (ownerLoaded && memberLoaded) {
        setLoading(false);
      }
    };

    const unsubOwner = onSnapshot(
      ownerQuery,
      (snap) => {
        ownerRows = snap.docs.map((d) => d.data() as ProjectDoc);
        ownerLoaded = true;
        applyMerged();
      },
      () => {
        ownerLoaded = true;
        applyMerged();
      }
    );

    const unsubMember = onSnapshot(
      memberQuery,
      (snap) => {
        memberRows = snap.docs.map((d) => d.data() as ProjectDoc);
        memberLoaded = true;
        applyMerged();
      },
      () => {
        memberLoaded = true;
        applyMerged();
      }
    );

    return () => {
      unsubOwner();
      unsubMember();
    };
  }, [userUid]);

  useEffect(() => {
    const uids = new Set<string>();

    projects.forEach((p) => {
      if (p.ownerUid) uids.add(p.ownerUid);
      sanitizeUids(p.members).forEach((uid) => uids.add(uid));
    });

    const needFetch = Array.from(uids).filter((uid) => !memberProfileByUid[uid]);
    if (needFetch.length === 0) return;

    let cancelled = false;

    (async () => {
      const updates: Record<string, MemberProfile> = {};

      await Promise.all(
        needFetch.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            if (!snap.exists()) return;

            const data = snap.data() as any;
            const email = normalizeEmail(data?.email ?? "");
            const name = safeTrim(data?.name) || fallbackNameFromEmail(email);

            updates[uid] = { uid, email, name };
          } catch {
            // ignore
          }
        })
      );

      if (cancelled) return;
      if (Object.keys(updates).length > 0) {
        setMemberProfileByUid((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const canCreate = useMemo(() => {
    return !!userUid && !!userEmail && newName.trim().length > 0;
  }, [userUid, userEmail, newName]);

  const createProject = async () => {
    if (!canCreate) return;
    const name = newName.trim();

    try {
      await runTransaction(db, async (tx) => {
        const counterRef = doc(db, "counters", "projects");

        const counterSnap = await tx.get(counterRef);
        const last = counterSnap.exists() ? Number(counterSnap.data().last ?? 0) : 0;
        const next = last + 1;

        const uid = `PRJ_${pad6(next)}`;
        const projectRef = doc(db, "projects", uid);

        const existing = await tx.get(projectRef);
        if (existing.exists()) {
          throw new Error("이미 존재하는 프로젝트 UID입니다. 다시 시도해주세요.");
        }

        tx.set(counterRef, { last: next }, { merge: true });
        tx.set(projectRef, {
          uid,
          name,
          ownerUid: userUid,
          ownerEmail: userEmail,
          members: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      setNewName("");
    } catch (e: any) {
      alert(e?.message ?? "프로젝트 생성 중 오류가 발생했습니다.");
    }
  };

  const saveName = async (uid: string) => {
    const name = editingName.trim();
    if (!name) {
      alert("프로젝트명을 입력해주세요.");
      return;
    }

    try {
      const projectRef = doc(db, "projects", uid);
      const snap = await getDoc(projectRef);
      if (!snap.exists()) {
        alert("프로젝트를 찾을 수 없습니다.");
        return;
      }

      const project = snap.data() as ProjectDoc;
      if (project.ownerUid !== userUid) {
        alert("오너만 프로젝트명을 수정할 수 있습니다.");
        return;
      }

      await updateDoc(projectRef, {
        name,
        updatedAt: serverTimestamp(),
      });

      setEditingUid(null);
      setEditingName("");
    } catch (e: any) {
      alert(e?.message ?? "프로젝트명 수정 중 오류가 발생했습니다.");
    }
  };

  const removeProject = async (uid: string) => {
    const ok = window.confirm(`정말 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.\n\n대상: ${uid}`);
    if (!ok) return;

    try {
      const projectRef = doc(db, "projects", uid);
      const snap = await getDoc(projectRef);
      if (!snap.exists()) {
        alert("프로젝트를 찾을 수 없습니다.");
        return;
      }

      const project = snap.data() as ProjectDoc;
      if (project.ownerUid !== userUid) {
        alert("오너만 프로젝트를 삭제할 수 있습니다.");
        return;
      }

      await deleteDoc(projectRef);
    } catch (e: any) {
      alert(e?.message ?? "프로젝트 삭제 중 오류가 발생했습니다.");
    }
  };

  const inviteMemberByEmail = async (projectUid: string) => {
    if (!userUid) return;

    const raw = inviteEmailByProject[projectUid] ?? "";
    const email = normalizeEmail(raw);

    if (!email) {
      alert("초대할 이메일을 입력해주세요.");
      return;
    }

    setInviteLoadingByProject((prev) => ({ ...prev, [projectUid]: true }));

    try {
      const projectRef = doc(db, "projects", projectUid);
      const projectSnap = await getDoc(projectRef);

      if (!projectSnap.exists()) {
        alert("프로젝트를 찾을 수 없습니다.");
        return;
      }

      const project = projectSnap.data() as ProjectDoc;
      if (project.ownerUid !== userUid) {
        alert("오너만 참여자를 추가할 수 있습니다.");
        return;
      }

      const uq = query(collection(db, "users"), where("email", "==", email), limit(1));
      const usnap = await getDocs(uq);

      if (usnap.empty) {
        alert("해당 이메일의 사용자를 찾을 수 없습니다.");
        return;
      }

      const userDocSnap = usnap.docs[0];
      const invitedUid = (userDocSnap.id ?? "").trim();

      if (!invitedUid) {
        alert("초대 대상 사용자 UID가 비정상입니다.");
        return;
      }

      if (invitedUid === userUid) {
        alert("본인은 참여자로 추가하지 않습니다.");
        return;
      }

      if (invitedUid === project.ownerUid) {
        alert("오너는 참여자로 추가할 수 없습니다.");
        return;
      }

      await updateDoc(projectRef, {
        members: arrayUnion(invitedUid),
        updatedAt: serverTimestamp(),
      });

      const data = userDocSnap.data() as any;
      const invitedEmail = normalizeEmail(data?.email ?? email);
      const invitedName = safeTrim(data?.name) || fallbackNameFromEmail(invitedEmail);

      setMemberProfileByUid((prev) => ({
        ...prev,
        [invitedUid]: { uid: invitedUid, email: invitedEmail, name: invitedName },
      }));

      setInviteEmailByProject((prev) => ({ ...prev, [projectUid]: "" }));
    } catch (e: any) {
      alert(e?.message ?? "참여자 추가 중 오류가 발생했습니다.");
    } finally {
      setInviteLoadingByProject((prev) => ({ ...prev, [projectUid]: false }));
    }
  };

  const removeMember = async (projectUid: string, memberUid: string, label: string) => {
    const ok = window.confirm(`참여자를 삭제하시겠습니까?\n\n대상: ${label}`);
    if (!ok) return;

    const key = `${projectUid}:${memberUid}`;
    setRemoveLoadingKey(key);

    try {
      const projectRef = doc(db, "projects", projectUid);
      const snap = await getDoc(projectRef);

      if (!snap.exists()) {
        alert("프로젝트를 찾을 수 없습니다.");
        return;
      }

      const project = snap.data() as ProjectDoc;
      if (project.ownerUid !== userUid) {
        alert("오너만 참여자를 삭제할 수 있습니다.");
        return;
      }

      await updateDoc(projectRef, {
        members: arrayRemove(memberUid),
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      alert(e?.message ?? "참여자 삭제 중 오류가 발생했습니다.");
    } finally {
      setRemoveLoadingKey("");
    }
  };

  const transferOwner = async (projectUid: string) => {
    if (!userUid) return;

    const newOwnerUid = (newOwnerUidByProject[projectUid] ?? "").trim();
    if (!newOwnerUid) {
      alert("오너로 변경할 참여자를 선택해주세요.");
      return;
    }

    const ok = window.confirm("오너를 변경하시겠습니까?\n변경 후 현재 계정에서는 목록에서 사라질 수 있습니다.");
    if (!ok) return;

    setOwnerTransferLoadingKey(projectUid);

    try {
      await runTransaction(db, async (tx) => {
        const projectRef = doc(db, "projects", projectUid);
        const projectSnap = await tx.get(projectRef);
        if (!projectSnap.exists()) throw new Error("프로젝트를 찾을 수 없습니다.");

        const project = projectSnap.data() as ProjectDoc;

        if (project.ownerUid !== userUid) {
          throw new Error("오너만 오너 변경을 수행할 수 있습니다.");
        }

        const members = sanitizeUids(project.members);
        if (!members.includes(newOwnerUid)) {
          throw new Error("선택한 사용자가 참여자 목록에 없습니다.");
        }

        const userRef = doc(db, "users", newOwnerUid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists()) throw new Error("새 오너 사용자 정보를 찾을 수 없습니다.");

        const udata = userSnap.data() as any;
        const newOwnerEmail = normalizeEmail(udata?.email ?? "");
        if (!newOwnerEmail) throw new Error("새 오너 이메일 정보가 없습니다.");

        tx.update(projectRef, {
          ownerUid: newOwnerUid,
          ownerEmail: newOwnerEmail,
          members: arrayRemove(newOwnerUid),
          updatedAt: serverTimestamp(),
        });
      });

      setNewOwnerUidByProject((prev) => ({ ...prev, [projectUid]: "" }));
      alert("오너 변경이 완료되었습니다.");
    } catch (e: any) {
      alert(e?.message ?? "오너 변경 중 오류가 발생했습니다.");
    } finally {
      setOwnerTransferLoadingKey("");
    }
  };

  if (!userUid) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-bold mb-2">Project 생성/관리</h1>
        <p className="text-sm opacity-80">로그인 후 이용 가능합니다.</p>
      </main>
    );
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Project 생성/관리</h1>
      </div>

      <section className="border rounded-md p-4 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold whitespace-nowrap">New Project</div>
          <input
            className="border rounded px-3 py-2 flex-1 min-w-[220px]"
            placeholder="Project 명"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="border rounded px-4 py-2 whitespace-nowrap"
            onClick={createProject}
            disabled={!canCreate}
            title={!canCreate ? "프로젝트명을 입력해주세요." : "생성"}
          >
            생성
          </button>
        </div>
      </section>

      <section className="border rounded-md p-4">
        <div className="font-semibold mb-3">My Project List</div>

        {loading ? (
          <p className="text-sm opacity-80">Loading...</p>
        ) : projects.length === 0 ? (
          <p className="text-sm opacity-80">참여 중인 프로젝트가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => {
              const isOwner = p.ownerUid === userUid;
              const isEditing = editingUid === p.uid;
              const inviteEmail = inviteEmailByProject[p.uid] ?? "";
              const inviteLoading = inviteLoadingByProject[p.uid] ?? false;

              const ownerProfile = memberProfileByUid[p.ownerUid];
              const ownerEmail = normalizeEmail(ownerProfile?.email ?? p.ownerEmail);
              const ownerName = safeTrim(ownerProfile?.name) || fallbackNameFromEmail(ownerEmail);
              const ownerLabel = formatMember(ownerEmail, ownerName);

              const memberUids = sanitizeUids(p.members);
              const memberLabels = memberUids.map((uid) => {
                const mp = memberProfileByUid[uid];
                if (!mp) return { uid, label: uid };
                return { uid, label: formatMember(mp.email, mp.name) };
              });

              const selectedNewOwnerUid = newOwnerUidByProject[p.uid] ?? "";
              const ownerTransferLoading = ownerTransferLoadingKey === p.uid;

              return (
                <div key={p.uid} className="border rounded-md p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-1 min-w-[260px]">
                      <div className="text-sm font-semibold whitespace-nowrap">{p.uid}</div>
                      <div className="text-sm opacity-70 whitespace-nowrap">:</div>

                      {!isEditing ? (
                        <div className="text-sm font-semibold truncate">{p.name}</div>
                      ) : (
                        <input
                          className="border rounded px-3 py-2 text-sm w-full min-w-[200px]"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          placeholder="Project 명"
                        />
                      )}
                    </div>

                    {isOwner ? (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            className="border rounded px-3 py-2 text-sm w-[260px] max-w-[60vw]"
                            placeholder="참여자 이메일"
                            value={inviteEmail}
                            onChange={(e) =>
                              setInviteEmailByProject((prev) => ({
                                ...prev,
                                [p.uid]: e.target.value,
                              }))
                            }
                          />
                          <button
                            className="border rounded px-3 py-2 text-sm whitespace-nowrap"
                            onClick={() => inviteMemberByEmail(p.uid)}
                            disabled={inviteLoading}
                            title="참여자 추가"
                          >
                            {inviteLoading ? "처리중" : "추가"}
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          {!isEditing ? (
                            <>
                              <button
                                className="border rounded px-3 py-2 text-sm whitespace-nowrap"
                                onClick={() => {
                                  setEditingUid(p.uid);
                                  setEditingName(p.name);
                                }}
                              >
                                수정
                              </button>
                              <button
                                className="border rounded px-3 py-2 text-sm whitespace-nowrap"
                                onClick={() => removeProject(p.uid)}
                              >
                                삭제
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="border rounded px-3 py-2 text-sm whitespace-nowrap"
                                onClick={() => saveName(p.uid)}
                              >
                                저장
                              </button>
                              <button
                                className="border rounded px-3 py-2 text-sm whitespace-nowrap"
                                onClick={() => {
                                  setEditingUid(null);
                                  setEditingName("");
                                }}
                              >
                                취소
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs opacity-70 border rounded px-3 py-2 whitespace-nowrap">
                        참여자 권한
                      </div>
                    )}
                  </div>

                  <div className="mt-2 text-xs opacity-80 flex flex-wrap items-center gap-2">
                    <span className="font-semibold whitespace-nowrap">참여자:</span>

                    <span className="inline-flex items-center gap-2 border rounded px-2 py-1">
                      <span className="whitespace-nowrap">{ownerLabel}</span>
                      <span className="text-[10px] opacity-70 whitespace-nowrap">Owner</span>
                    </span>

                    {isOwner && memberUids.length > 0 && (
                      <span className="inline-flex items-center gap-2 border rounded px-2 py-1">
                        <span className="whitespace-nowrap">오너 변경</span>

                        <select
                          style={{ colorScheme: "light" }}
                          className="border rounded px-2 py-1 text-xs bg-white/90 text-black border-black/20 dark:bg-white/90 dark:text-black dark:border-white/20"
                          value={selectedNewOwnerUid}
                          onChange={(e) =>
                            setNewOwnerUidByProject((prev) => ({
                              ...prev,
                              [p.uid]: e.target.value,
                            }))
                          }
                        >
                          <option value="">선택</option>
                          {memberLabels.map(({ uid, label }) => (
                            <option key={uid} value={uid}>
                              {label}
                            </option>
                          ))}
                        </select>

                        <button
                          className="border rounded px-2 py-0.5 text-[11px] whitespace-nowrap"
                          onClick={() => transferOwner(p.uid)}
                          disabled={ownerTransferLoading}
                          title="오너 변경"
                        >
                          {ownerTransferLoading ? "..." : "변경"}
                        </button>
                      </span>
                    )}

                    {memberLabels.length === 0 ? (
                      <span className="opacity-70 whitespace-nowrap">없음</span>
                    ) : (
                      memberLabels.map(({ uid, label }) => {
                        const key = `${p.uid}:${uid}`;
                        const removing = removeLoadingKey === key;

                        return (
                          <span key={uid} className="inline-flex items-center gap-2 border rounded px-2 py-1">
                            <span className="whitespace-nowrap">{label}</span>

                            {isOwner && (
                              <button
                                className="border rounded px-2 py-0.5 text-[11px] whitespace-nowrap"
                                onClick={() => removeMember(p.uid, uid, label)}
                                disabled={removing}
                                title="참여자 삭제"
                              >
                                {removing ? "..." : "삭제"}
                              </button>
                            )}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}