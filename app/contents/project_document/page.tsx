"use client";

/**
 * projnow/app/contents/project_document/page.tsx
 *
 * ✅ 목표
 * - Project → Category(무한 하위) 트리 저장(Firestore)
 * - Category 하단: 파일 등록폼 여러 개 생성(로컬 UI 상태)
 * - 파일 업로드 1개씩(Drag&Drop/선택) → Storage 저장 + Firestore 메타 저장
 * - 동일 파일명 경고 + 버전 입력 분리
 * - 각 파일마다 Modification List 생성/삭제(Storage + Firestore)
 * - 생성/삭제/업로드 등 이력은 별도 audit 컬렉션에 기록(Firestore)
 *
 * ✅ 빌드 에러 대응
 * - "@/lib/firebaseClient" 같은 프로젝트 내부 경로 의존 없이
 *   이 파일 내부에서 Firebase Client SDK 초기화를 수행합니다.
 *
 * ⚠️ 필수 환경변수 (Vercel/로컬 .env)
 * - NEXT_PUBLIC_FIREBASE_API_KEY
 * - NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 * - NEXT_PUBLIC_FIREBASE_PROJECT_ID
 * - NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 * - NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 * - NEXT_PUBLIC_FIREBASE_APP_ID
 */

import React, { useEffect, useMemo, useState } from "react";

// Firebase Client SDK (직접 초기화)
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, type Auth } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  type FirebaseStorage,
} from "firebase/storage";

/** -----------------------------
 * Firebase init (이 파일에서 안전하게 1회 초기화)
 * ------------------------------ */
function getFirebaseClient(): { app: FirebaseApp; auth: Auth; db: Firestore; storage: FirebaseStorage } {
  // 환경변수 누락 시 런타임에서 알기 쉬운 메시지
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  };

  // 최소 값 확인(빈 문자열/undefined 방지)
  const missing = Object.entries(cfg).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error("[ProjectDocument] Missing Firebase env:", missing);
  }

  const app = getApps().length ? getApp() : initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  return { app, auth, db, storage };
}

/** -----------------------------
 * Types
 * ------------------------------ */
type NodeType = "project" | "category";

type ProjectDoc = {
  id: string;
  name: string;
  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string | null;
};

type TreeNode = {
  id: string;
  projectId: string;
  type: NodeType;
  parentId: string | null;
  name: string;
  order: number;
  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string | null;
};

type FileItem = {
  id: string;
  projectId: string;
  nodeId: string;
  displayName: string; // 사용자 입력 파일명
  version: string; // 사용자 입력 버전
  originalName: string; // 업로드 실제 파일명
  storagePath: string;
  downloadUrl?: string;
  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string | null;
};

type ModDoc = {
  id: string;
  projectId: string;
  fileId: string;
  storagePath: string;
  downloadUrl?: string;
  createdAt?: any;
  createdBy?: string;
  createdByEmail?: string | null;
};

type AuditAction =
  | "PROJECT_CREATE"
  | "CATEGORY_CREATE"
  | "CATEGORY_DELETE"
  | "FILE_UPLOAD"
  | "FILE_DELETE"
  | "MOD_CREATE"
  | "MOD_DELETE";

export default function ProjectDocumentPage() {
  /** -----------------------------
   * Firebase handles
   * ------------------------------ */
  const { auth, db, storage } = useMemo(() => getFirebaseClient(), []);

  /** -----------------------------
   * Auth state
   * ------------------------------ */
  const [uid, setUid] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  /** -----------------------------
   * UI/데이터 state
   * ------------------------------ */
  const [loading, setLoading] = useState(false);

  // (1) 프로젝트명 입력 및 저장
  const [projectName, setProjectName] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // 로드된 데이터
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [mods, setMods] = useState<ModDoc[]>([]);

  // 카테고리 생성 입력값(부모 노드별)
  const [newCategoryNameByParent, setNewCategoryNameByParent] = useState<Record<string, string>>({});

  /** -----------------------------
   * Upload form UI state (DB 저장 아님)
   * ------------------------------ */
  type UploadForm = {
    formId: string;
    displayName: string;
    version: string;
    fileObj: File | null;
    duplicateNameWarn: boolean;
  };
  const [uploadFormsByNode, setUploadFormsByNode] = useState<Record<string, UploadForm[]>>({});

  /** -----------------------------
   * Effects
   * ------------------------------ */
  useEffect(() => {
    // 로그인 상태 구독
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setUid(null);
        setUserEmail(null);
        return;
      }
      setUid(user.uid);
      setUserEmail(user.email ?? null);
    });
    return () => unsub();
  }, [auth]);

  useEffect(() => {
    if (!activeProjectId) return;
    void loadProjectAll(activeProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  /** -----------------------------
   * Memo maps
   * ------------------------------ */
  const rootNodeId = useMemo(() => {
    const root = nodes.find((n) => n.type === "project" && n.projectId === activeProjectId);
    return root?.id ?? null;
  }, [nodes, activeProjectId]);

  const nodesByParent = useMemo(() => {
    const map: Record<string, TreeNode[]> = {};
    for (const n of nodes) {
      const key = n.parentId ?? "__ROOT__";
      if (!map[key]) map[key] = [];
      map[key].push(n);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.order - b.order);
    }
    return map;
  }, [nodes]);

  const filesByNode = useMemo(() => {
    const map: Record<string, FileItem[]> = {};
    for (const f of files) {
      if (!map[f.nodeId]) map[f.nodeId] = [];
      map[f.nodeId].push(f);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.displayName + a.version).localeCompare(b.displayName + b.version));
    }
    return map;
  }, [files]);

  const modsByFile = useMemo(() => {
    const map: Record<string, ModDoc[]> = {};
    for (const m of mods) {
      if (!map[m.fileId]) map[m.fileId] = [];
      map[m.fileId].push(m);
    }
    return map;
  }, [mods]);

  /** -----------------------------
   * Helpers
   * ------------------------------ */
  function makeLocalId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  async function writeAudit(projectId: string, action: AuditAction, payload: Record<string, any>) {
    // (9) 별도 테이블에 이력관리
    if (!uid) return;
    await addDoc(collection(db, "project_document_audit"), {
      projectId,
      action,
      payload,
      createdBy: uid,
      createdByEmail: userEmail ?? null,
      createdAt: serverTimestamp(),
    });
  }

  /** -----------------------------
   * Loaders
   * ------------------------------ */
  async function loadProjectAll(projectId: string) {
    setLoading(true);
    try {
      // project meta
      const pSnap = await getDoc(doc(db, "project_documents", projectId));
      setProject(pSnap.exists() ? ({ id: pSnap.id, ...(pSnap.data() as any) } as ProjectDoc) : null);

      // nodes
      const nodesQ = query(
        collection(db, "project_document_nodes"),
        where("projectId", "==", projectId),
        orderBy("order", "asc")
      );
      const nSnap = await getDocs(nodesQ);
      setNodes(nSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TreeNode[]);

      // files
      const filesQ = query(collection(db, "project_document_files"), where("projectId", "==", projectId));
      const fSnap = await getDocs(filesQ);
      setFiles(fSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FileItem[]);

      // mods
      const modsQ = query(collection(db, "project_document_mods"), where("projectId", "==", projectId));
      const mSnap = await getDocs(modsQ);
      setMods(mSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ModDoc[]);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * (1) Project create/save
   * ------------------------------ */
  async function handleCreateProject() {
    if (!uid) {
      alert("로그인이 필요합니다.");
      return;
    }
    const name = projectName.trim();
    if (!name) {
      alert("Project 명을 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      // 프로젝트 생성
      const projectRef = await addDoc(collection(db, "project_documents"), {
        name,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 프로젝트 루트 노드 생성(type="project")
      await addDoc(collection(db, "project_document_nodes"), {
        projectId: projectRef.id,
        type: "project",
        parentId: null,
        name,
        order: 0,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      await writeAudit(projectRef.id, "PROJECT_CREATE", { name });

      // 활성 프로젝트 설정
      setActiveProjectId(projectRef.id);
      setProjectName("");
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * (2)(3) Category create/delete
   * ------------------------------ */
  async function handleAddCategory(parentId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }
    const name = (newCategoryNameByParent[parentId] ?? "").trim();
    if (!name) {
      alert("카테고리명을 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      const siblings = nodes.filter((n) => n.parentId === parentId);
      const nextOrder = siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 1;

      const nodeRef = await addDoc(collection(db, "project_document_nodes"), {
        projectId: activeProjectId,
        type: "category",
        parentId,
        name,
        order: nextOrder,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      await writeAudit(activeProjectId, "CATEGORY_CREATE", { nodeId: nodeRef.id, parentId, name });

      setNewCategoryNameByParent((prev) => ({ ...prev, [parentId]: "" }));
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteCategory(nodeId: string) {
    // 안전장치: 하위/파일 존재 시 삭제 불가
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const hasChild = nodes.some((n) => n.parentId === nodeId);
    const hasFiles = files.some((f) => f.nodeId === nodeId);
    if (hasChild || hasFiles) {
      alert("하위 카테고리 또는 파일이 존재하여 삭제할 수 없습니다.\n(먼저 하위 항목을 정리해 주세요.)");
      return;
    }

    if (!confirm("카테고리를 삭제하시겠습니까?")) return;

    setLoading(true);
    try {
      await deleteDoc(doc(db, "project_document_nodes", nodeId));
      await writeAudit(activeProjectId, "CATEGORY_DELETE", { nodeId });
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * (4)(5) Upload form add/remove/update
   * ------------------------------ */
  function addUploadForm(nodeId: string) {
    const newForm: UploadForm = {
      formId: makeLocalId("form"),
      displayName: "",
      version: "",
      fileObj: null,
      duplicateNameWarn: false,
    };
    setUploadFormsByNode((prev) => {
      const next = { ...prev };
      const arr = next[nodeId] ? [...next[nodeId]] : [];
      arr.push(newForm);
      next[nodeId] = arr;
      return next;
    });
  }

  function removeUploadForm(nodeId: string, formId: string) {
    setUploadFormsByNode((prev) => {
      const next = { ...prev };
      next[nodeId] = (next[nodeId] ?? []).filter((f) => f.formId !== formId);
      return next;
    });
  }

  function updateUploadForm(nodeId: string, formId: string, patch: Partial<UploadForm>) {
    setUploadFormsByNode((prev) => {
      const next = { ...prev };
      const arr = next[nodeId] ? [...next[nodeId]] : [];
      next[nodeId] = arr.map((f) => (f.formId === formId ? { ...f, ...patch } : f));
      return next;
    });
  }

  /** -----------------------------
   * (6) Duplicate name check
   * ------------------------------ */
  function checkDuplicateName(nodeId: string, displayName: string): boolean {
    // 동일 카테고리 내 중복 기준(원하면 프로젝트 전체로 확장 가능)
    const dn = displayName.trim().toLowerCase();
    if (!dn) return false;
    return (filesByNode[nodeId] ?? []).some((f) => f.displayName.trim().toLowerCase() === dn);
  }

  /** -----------------------------
   * Drag & Drop
   * ------------------------------ */
  function handleDrop(nodeId: string, formId: string, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0] ?? null;
    if (!file) return;
    updateUploadForm(nodeId, formId, { fileObj: file });
  }

  /** -----------------------------
   * (4) File upload
   * ------------------------------ */
  async function handleUpload(nodeId: string, form: UploadForm) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const displayName = form.displayName.trim();
    const version = form.version.trim();
    const fileObj = form.fileObj;

    if (!displayName) {
      alert("파일명을 입력해 주세요.");
      return;
    }
    if (!fileObj) {
      alert("업로드할 파일을 선택하거나 드래그하여 추가해 주세요.");
      return;
    }

    const isDup = checkDuplicateName(nodeId, displayName);
    if (isDup && !version) {
      // 동일 파일명인데 버전이 없으면 경고
      updateUploadForm(nodeId, form.formId, { duplicateNameWarn: true });
      alert("동일한 파일명이 이미 존재합니다. 버전을 입력해 주세요. (예: v1.1, v2)");
      return;
    }

    setLoading(true);
    try {
      // Firestore 문서 먼저 생성(문서 ID 확보)
      const fileRef = await addDoc(collection(db, "project_document_files"), {
        projectId: activeProjectId,
        nodeId,
        displayName,
        version: version || "",
        originalName: fileObj.name,
        storagePath: "",
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      // Storage 업로드
      const storagePath = `project_documents/${activeProjectId}/files/${fileRef.id}/${fileObj.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, fileObj);

      // 다운로드 URL
      const downloadUrl = await getDownloadURL(storageRef);

      // Firestore 업데이트
      await updateDoc(doc(db, "project_document_files", fileRef.id), {
        storagePath,
        downloadUrl,
      });

      await writeAudit(activeProjectId, "FILE_UPLOAD", {
        fileId: fileRef.id,
        nodeId,
        displayName,
        version: version || "",
        originalName: fileObj.name,
      });

      // 폼 일부 초기화
      updateUploadForm(nodeId, form.formId, { fileObj: null, duplicateNameWarn: false });

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }
    const target = files.find((f) => f.id === fileId);
    if (!target) return;

    // 연결된 mod가 있으면 먼저 삭제 유도
    const linkedMods = (modsByFile[fileId] ?? []).length;
    if (linkedMods > 0) {
      alert("이 파일에 연결된 Modification List 문서가 있습니다. 먼저 문서를 삭제해 주세요.");
      return;
    }

    if (!confirm("파일을 삭제하시겠습니까?")) return;

    setLoading(true);
    try {
      if (target.storagePath) {
        await deleteObject(ref(storage, target.storagePath));
      }
      await deleteDoc(doc(db, "project_document_files", fileId));
      await writeAudit(activeProjectId, "FILE_DELETE", { fileId });
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * (7) Modification List create/delete
   * ------------------------------ */
  async function handleCreateMod(file: FileItem) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    setLoading(true);
    try {
      const modRef = await addDoc(collection(db, "project_document_mods"), {
        projectId: activeProjectId,
        fileId: file.id,
        storagePath: "",
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      // 템플릿 문서(현재는 md로 생성)
      const content = [
        `# Modification List`,
        ``,
        `- ProjectId: ${activeProjectId}`,
        `- File: ${file.displayName}`,
        `- Version: ${file.version || "(none)"}`,
        `- Original: ${file.originalName}`,
        `- CreatedAt: ${new Date().toISOString()}`,
        ``,
        `## Changes`,
        `- (예) 항목 추가: ...`,
        `- (예) 항목 수정: ...`,
        `- (예) 항목 삭제: ...`,
        ``,
      ].join("\n");

      const storagePath = `project_documents/${activeProjectId}/mods/${file.id}/${modRef.id}.md`;
      const storageRef = ref(storage, storagePath);
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
      await uploadBytes(storageRef, blob);

      const downloadUrl = await getDownloadURL(storageRef);

      await updateDoc(doc(db, "project_document_mods", modRef.id), {
        storagePath,
        downloadUrl,
      });

      await writeAudit(activeProjectId, "MOD_CREATE", {
        modId: modRef.id,
        fileId: file.id,
        storagePath,
      });

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteMod(modId: string) {
    if (!uid || !activeProjectId) {
      alert("로그인이 필요합니다.");
      return;
    }

    const target = mods.find((m) => m.id === modId);
    if (!target) return;

    if (!confirm("Modification List 문서를 삭제하시겠습니까?")) return;

    setLoading(true);
    try {
      if (target.storagePath) {
        await deleteObject(ref(storage, target.storagePath));
      }
      await deleteDoc(doc(db, "project_document_mods", modId));
      await writeAudit(activeProjectId, "MOD_DELETE", { modId, fileId: target.fileId });
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * UI - recursive render
   * ------------------------------ */
  function renderNode(node: TreeNode, depth: number) {
    const childNodes = nodesByParent[node.id] ?? [];
    const nodeFiles = filesByNode[node.id] ?? [];
    const uploadForms = uploadFormsByNode[node.id] ?? [];
    const indent = Math.min(depth * 16, 64);

    return (
      <div key={node.id} className="border rounded-md p-3 mb-3 bg-white/50 dark:bg-black/20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
            <span className="text-sm font-semibold">
              {node.type === "project" ? "📌 Project" : "📁 Category"}: {node.name}
            </span>
            {node.type === "category" && (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border"
                onClick={() => handleDeleteCategory(node.id)}
                disabled={loading}
                title="하위/파일이 없을 때만 삭제 가능"
              >
                삭제
              </button>
            )}
          </div>

          {/* (2)(3) 하위 카테고리 생성 */}
          <div className="flex items-center gap-2">
            <input
              className="border rounded px-2 py-1 text-sm w-48 bg-transparent"
              placeholder="하위 카테고리명"
              value={newCategoryNameByParent[node.id] ?? ""}
              onChange={(e) => setNewCategoryNameByParent((prev) => ({ ...prev, [node.id]: e.target.value }))}
              disabled={loading}
            />
            <button
              type="button"
              className="px-3 py-1 rounded border text-sm"
              onClick={() => handleAddCategory(node.id)}
              disabled={loading}
            >
              + 카테고리 생성
            </button>
          </div>
        </div>

        {/* (4)(5)(6) 카테고리 하단: 파일 등록 */}
        {node.type === "category" && (
          <div className="mt-4" style={{ paddingLeft: indent }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">📎 파일 등록</div>
              <button
                type="button"
                className="px-3 py-1 rounded border text-sm"
                onClick={() => addUploadForm(node.id)}
                disabled={loading}
              >
                + 파일 등록폼 추가
              </button>
            </div>

            <div className="space-y-3">
              {uploadForms.map((form) => {
                const isDup = checkDuplicateName(node.id, form.displayName);
                return (
                  <div key={form.formId} className="border rounded p-3 bg-white dark:bg-black/30">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-sm font-semibold">등록 폼</div>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border"
                        onClick={() => removeUploadForm(node.id, form.formId)}
                        disabled={loading}
                      >
                        폼 제거
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {/* 파일명 */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs opacity-70">파일명(표시명)</label>
                        <input
                          className="border rounded px-2 py-2 text-sm bg-transparent"
                          placeholder="예: CRF Specification"
                          value={form.displayName}
                          onChange={(e) =>
                            updateUploadForm(node.id, form.formId, {
                              displayName: e.target.value,
                              duplicateNameWarn: false,
                            })
                          }
                          disabled={loading}
                        />
                        {(isDup || form.duplicateNameWarn) && (
                          <div className="text-xs text-red-600">동일 파일명이 존재합니다. 버전을 입력해 주세요.</div>
                        )}
                      </div>

                      {/* 버전 */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs opacity-70">버전</label>
                        <input
                          className="border rounded px-2 py-2 text-sm bg-transparent"
                          placeholder="예: v1.0 / v2"
                          value={form.version}
                          onChange={(e) => updateUploadForm(node.id, form.formId, { version: e.target.value })}
                          disabled={loading}
                        />
                      </div>

                      {/* 파일 선택/드롭 */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs opacity-70">파일</label>
                        <div
                          className="border rounded px-2 py-2 text-sm bg-transparent"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDrop(node.id, form.formId, e)}
                          title="여기에 파일을 드래그&드롭하거나 아래에서 선택하세요."
                        >
                          {form.fileObj ? `선택됨: ${form.fileObj.name}` : "여기로 드래그&드롭"}
                        </div>
                        <input
                          type="file"
                          className="text-sm"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            updateUploadForm(node.id, form.formId, { fileObj: f });
                          }}
                          disabled={loading}
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        className="px-3 py-2 rounded border text-sm"
                        onClick={() => handleUpload(node.id, form)}
                        disabled={loading}
                      >
                        업로드
                      </button>
                    </div>
                  </div>
                );
              })}

              {uploadForms.length === 0 && <div className="text-sm opacity-70">파일 등록폼을 추가해 주세요.</div>}
            </div>

            {/* 등록된 파일 목록 */}
            <div className="mt-4">
              <div className="text-sm font-medium mb-2">📄 등록된 파일</div>
              {nodeFiles.length === 0 ? (
                <div className="text-sm opacity-70">등록된 파일이 없습니다.</div>
              ) : (
                <div className="space-y-2">
                  {nodeFiles.map((f) => {
                    const linkedMods = modsByFile[f.id] ?? [];
                    return (
                      <div key={f.id} className="border rounded p-3 bg-white dark:bg-black/30">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm">
                            <div className="font-semibold">
                              {f.displayName}{" "}
                              {f.version ? <span className="text-xs opacity-70">({f.version})</span> : null}
                            </div>
                            <div className="text-xs opacity-70">원본 파일: {f.originalName}</div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {f.downloadUrl && (
                              <a
                                className="px-3 py-1 rounded border text-sm"
                                href={f.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                다운로드
                              </a>
                            )}

                            {/* (7) Mod 생성 */}
                            <button
                              type="button"
                              className="px-3 py-1 rounded border text-sm"
                              onClick={() => handleCreateMod(f)}
                              disabled={loading}
                              title="이 파일 버전에 대한 변경사항 문서를 생성합니다."
                            >
                              + Modification List 생성
                            </button>

                            <button
                              type="button"
                              className="px-3 py-1 rounded border text-sm"
                              onClick={() => handleDeleteFile(f.id)}
                              disabled={loading}
                            >
                              파일 삭제
                            </button>
                          </div>
                        </div>

                        {/* (8) 생성된 Mod 문서 삭제 */}
                        <div className="mt-3">
                          <div className="text-xs font-semibold opacity-80 mb-1">Modification List</div>
                          {linkedMods.length === 0 ? (
                            <div className="text-xs opacity-70">생성된 문서가 없습니다.</div>
                          ) : (
                            <div className="space-y-1">
                              {linkedMods.map((m) => (
                                <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                                  <div className="flex items-center gap-2">
                                    <span>📄 {m.id}.md</span>
                                    {m.downloadUrl && (
                                      <a href={m.downloadUrl} target="_blank" rel="noreferrer" className="underline">
                                        다운로드
                                      </a>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    className="px-2 py-1 rounded border"
                                    onClick={() => handleDeleteMod(m.id)}
                                    disabled={loading}
                                  >
                                    문서 삭제
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 하위 카테고리 렌더 */}
        {childNodes.length > 0 && <div className="mt-3 space-y-3">{childNodes.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    );
  }

  /** -----------------------------
   * Render
   * ------------------------------ */
  return (
    <main className="p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-bold">Project Document</h1>
        <div className="text-xs opacity-70">{uid ? `로그인: ${userEmail ?? uid}` : "비로그인"}</div>
      </div>

      {/* (1) 프로젝트 생성 */}
      <section className="border rounded-md p-4 mb-6 bg-white/50 dark:bg-black/20">
        <div className="flex flex-col md:flex-row items-start md:items-end gap-3 justify-between">
          <div className="flex-1">
            <div className="text-sm font-semibold mb-2">프로젝트 생성</div>
            <input
              className="border rounded px-3 py-2 w-full md:w-[420px] bg-transparent"
              placeholder="Project 명 입력"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              disabled={loading}
            />
          </div>
          <button type="button" className="px-4 py-2 rounded border" onClick={handleCreateProject} disabled={loading}>
            저장
          </button>
        </div>

        <div className="mt-3 text-sm">
          <span className="font-semibold">현재 프로젝트: </span>
          <span className="opacity-80">
            {activeProjectId ? `${project?.name ?? "(로드중)"} (${activeProjectId})` : "없음"}
          </span>
        </div>
      </section>

      {/* 트리 영역 */}
      {!activeProjectId ? (
        <div className="text-sm opacity-70">프로젝트를 생성하면 카테고리/파일 등록이 가능합니다.</div>
      ) : (
        <section>
          {loading && <div className="text-sm opacity-70 mb-3">처리 중...</div>}
          {!rootNodeId ? (
            <div className="text-sm opacity-70">프로젝트 루트 노드를 찾을 수 없습니다.</div>
          ) : (
            nodes.filter((n) => n.id === rootNodeId).map((root) => renderNode(root, 0))
          )}
        </section>
      )}
    </main>
  );
}
