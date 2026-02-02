"use client";

/**
 * projnow/app/contents/project_document/page.tsx
 *
 * ✅ 반영된 요구사항
 * 1) 프로젝트 목록을 "생성자(uid)" 기준으로 자동 조회
 * 2) 페이지 진입 시 "가장 최근 프로젝트" 자동 선택
 * 3) 선택된 프로젝트 하위에 카테고리/파일/문서가 나열됨
 * 4) 프로젝트 생성 시에도 해당 프로젝트 자동 선택
 * 5) 프로젝트 생성 시: 기본 카테고리 1개 + 기본 파일 등록폼 1개 자동 생성
 *
 * ⚠️ Firebase 초기화는 이 파일 내부에서 수행(프로젝트 내부 경로 의존 제거)
 * ⚠️ 필수 환경변수:
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
  limit,
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
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  };

  // 누락된 환경변수 체크(디버그용)
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
  displayName: string;
  version: string;
  originalName: string;
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

  // ✅ 사용자 프로젝트 목록(본인이 생성한 프로젝트들)
  const [myProjects, setMyProjects] = useState<ProjectDoc[]>([]);

  // ✅ 현재 선택된 프로젝트
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // 로드된 데이터(선택된 프로젝트 기준)
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
        setMyProjects([]);
        setActiveProjectId(null);
        setProject(null);
        setNodes([]);
        setFiles([]);
        setMods([]);
        return;
      }
      setUid(user.uid);
      setUserEmail(user.email ?? null);
    });
    return () => unsub();
  }, [auth]);

  useEffect(() => {
    // ✅ 로그인(uid)이 잡히면: 내 프로젝트 목록 자동 로드 + 최근 프로젝트 자동 선택
    if (!uid) return;
    void loadMyProjectsAndAutoSelect(uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    // ✅ 프로젝트 선택되면 하위 데이터 로드
    if (!activeProjectId) return;
    void loadProjectAll(activeProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  /** -----------------------------
   * Memo maps
   * ------------------------------ */
  const rootNodeId = useMemo(() => {
    // 프로젝트 루트 노드(type="project") 찾기
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

  function createDefaultUploadForm(): UploadForm {
    // ✅ 기본 파일 등록폼(1개)
    return {
      formId: makeLocalId("form"),
      displayName: "",
      version: "",
      fileObj: null,
      duplicateNameWarn: false,
    };
  }

  function ensureOneUploadForm(nodeId: string) {
    // ✅ 특정 카테고리(nodeId)에 업로드폼이 0개면 1개 자동 생성
    setUploadFormsByNode((prev) => {
      const curr = prev[nodeId] ?? [];
      if (curr.length > 0) return prev;
      return { ...prev, [nodeId]: [createDefaultUploadForm()] };
    });
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
   * ✅ 내 프로젝트 목록 로드 + 최근 프로젝트 자동 선택
   * ------------------------------ */
  async function loadMyProjectsAndAutoSelect(myUid: string) {
    setLoading(true);
    try {
      // createdBy == myUid 인 프로젝트만 가져옴 (최근 생성순)
      const qy = query(
        collection(db, "project_documents"),
        where("createdBy", "==", myUid),
        orderBy("createdAt", "desc"),
        limit(50)
      );

      const snap = await getDocs(qy);
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ProjectDoc[];
      setMyProjects(list);

      // ✅ "기본 선택": 현재 선택이 없으면, 가장 최근 프로젝트를 자동 선택
      if (!activeProjectId && list.length > 0) {
        setActiveProjectId(list[0].id);
      }

      // ✅ 이미 선택된 프로젝트가 있는데 목록에 없으면(권한/삭제 등) 최근 프로젝트로 보정
      if (activeProjectId && list.length > 0) {
        const exists = list.some((p) => p.id === activeProjectId);
        if (!exists) setActiveProjectId(list[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * Loaders (선택된 프로젝트 하위 데이터)
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
      const nList = nSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TreeNode[];
      setNodes(nList);

      // files
      const filesQ = query(collection(db, "project_document_files"), where("projectId", "==", projectId));
      const fSnap = await getDocs(filesQ);
      setFiles(fSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FileItem[]);

      // mods
      const modsQ = query(collection(db, "project_document_mods"), where("projectId", "==", projectId));
      const mSnap = await getDocs(modsQ);
      setMods(mSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ModDoc[]);

      // ✅ 첫 카테고리에 기본 폼이 없으면 자동 1개 생성(화면 표시용)
      const firstCategory = nList.find((n) => n.type === "category");
      if (firstCategory) ensureOneUploadForm(firstCategory.id);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * (1) Project create/save
   * - 프로젝트 생성 후: 자동 선택 + 목록 갱신
   * - 기본 카테고리 1개 + 기본 파일폼 1개 자동 생성
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
      // 1) 프로젝트 문서 생성
      const projectRef = await addDoc(collection(db, "project_documents"), {
        name,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2) 프로젝트 루트 노드 생성(type="project")
      const rootRef = await addDoc(collection(db, "project_document_nodes"), {
        projectId: projectRef.id,
        type: "project",
        parentId: null,
        name,
        order: 0,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      // 3) 기본 카테고리 자동 생성
      const defaultCategoryName = "Default Category";
      const categoryRef = await addDoc(collection(db, "project_document_nodes"), {
        projectId: projectRef.id,
        type: "category",
        parentId: rootRef.id,
        name: defaultCategoryName,
        order: 1,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
      });

      // 4) 기본 파일 등록폼 1개 자동 생성(로컬 UI)
      setUploadFormsByNode(() => ({
        [categoryRef.id]: [createDefaultUploadForm()],
      }));

      // 로그
      await writeAudit(projectRef.id, "PROJECT_CREATE", { name });
      await writeAudit(projectRef.id, "CATEGORY_CREATE", {
        nodeId: categoryRef.id,
        parentId: rootRef.id,
        name: defaultCategoryName,
        auto: true,
      });

      // ✅ 중요: 생성된 프로젝트를 자동 선택(요구사항)
      setActiveProjectId(projectRef.id);

      // 입력 초기화
      setProjectName("");

      // ✅ 내 프로젝트 목록 갱신(선택은 유지)
      await loadMyProjectsAndAutoSelect(uid);
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

      // ✅ 새 카테고리에 기본 파일 등록폼 1개 자동 생성(표시용)
      ensureOneUploadForm(nodeRef.id);

      setNewCategoryNameByParent((prev) => ({ ...prev, [parentId]: "" }));
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteCategory(nodeId: string) {
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

      // 로컬 폼 상태 정리
      setUploadFormsByNode((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });

      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * Upload form handlers
   * ------------------------------ */
  function addUploadForm(nodeId: string) {
    const newForm = createDefaultUploadForm();
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

      // ✅ 최소 1개 유지(원하시면 제거 가능)
      if ((next[nodeId] ?? []).length === 0) {
        next[nodeId] = [createDefaultUploadForm()];
      }
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
   * Duplicate name check
   * ------------------------------ */
  function checkDuplicateName(nodeId: string, displayName: string): boolean {
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
   * File upload / delete
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
      updateUploadForm(nodeId, form.formId, { duplicateNameWarn: true });
      alert("동일한 파일명이 이미 존재합니다. 버전을 입력해 주세요. (예: v1.1, v2)");
      return;
    }

    setLoading(true);
    try {
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

      const storagePath = `project_documents/${activeProjectId}/files/${fileRef.id}/${fileObj.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, fileObj);

      const downloadUrl = await getDownloadURL(storageRef);

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

    const linkedMods = (modsByFile[fileId] ?? []).length;
    if (linkedMods > 0) {
      alert("이 파일에 연결된 Modification List 문서가 있습니다. 먼저 문서를 삭제해 주세요.");
      return;
    }

    if (!confirm("파일을 삭제하시겠습니까?")) return;

    setLoading(true);
    try {
      if (target.storagePath) await deleteObject(ref(storage, target.storagePath));
      await deleteDoc(doc(db, "project_document_files", fileId));
      await writeAudit(activeProjectId, "FILE_DELETE", { fileId });
      await loadProjectAll(activeProjectId);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * Mod create/delete
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
      if (target.storagePath) await deleteObject(ref(storage, target.storagePath));
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

          {/* 하위 카테고리 생성 */}
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

        {/* 카테고리 하단: 파일 등록폼 + 파일 목록 */}
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

            {/* 업로드 폼 */}
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

                      {/* 파일 */}
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

              {/* 방어: 폼이 0개면 1개 생성 버튼 */}
              {uploadForms.length === 0 && (
                <button
                  type="button"
                  className="px-3 py-2 rounded border text-sm"
                  onClick={() => ensureOneUploadForm(node.id)}
                  disabled={loading}
                >
                  기본 파일 등록폼 생성
                </button>
              )}
            </div>

            {/* 파일 목록 */}
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

      {/* ✅ 내 프로젝트 선택 영역 (자동 선택 + 수동 변경 가능) */}
      <section className="border rounded-md p-4 mb-6 bg-white/50 dark:bg-black/20">
        <div className="flex flex-col md:flex-row gap-3 items-start md:items-end justify-between">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold">내 프로젝트</div>
            <select
              className="border rounded px-3 py-2 w-full md:w-[420px] bg-transparent"
              value={activeProjectId ?? ""}
              onChange={(e) => setActiveProjectId(e.target.value || null)}
              disabled={loading || !uid}
            >
              <option value="">(프로젝트 선택)</option>
              {myProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
            <div className="text-xs opacity-70">
              {myProjects.length === 0
                ? "생성된 프로젝트가 없습니다. 아래에서 프로젝트를 생성하세요."
                : "페이지 진입 시 최근 프로젝트가 자동 선택됩니다."}
            </div>
          </div>

          {/* (1) 프로젝트 생성 */}
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold">프로젝트 생성</div>
            <div className="flex gap-2">
              <input
                className="border rounded px-3 py-2 w-full md:w-[320px] bg-transparent"
                placeholder="Project 명 입력"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                className="px-4 py-2 rounded border"
                onClick={handleCreateProject}
                disabled={loading}
              >
                저장
              </button>
            </div>
          </div>
        </div>

        {/* 현재 프로젝트 표시 */}
        <div className="mt-3 text-sm">
          <span className="font-semibold">현재 프로젝트: </span>
          <span className="opacity-80">
            {activeProjectId ? `${project?.name ?? "(로드중)"} (${activeProjectId})` : "없음"}
          </span>
        </div>
      </section>

      {/* 트리 영역 */}
      {!activeProjectId ? (
        <div className="text-sm opacity-70">프로젝트를 선택(또는 생성)하면 하위 문서 트리가 표시됩니다.</div>
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
