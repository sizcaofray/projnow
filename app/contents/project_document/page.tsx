"use client";

/**
 * projnow/app/contents/project_document/page.tsx
 *
 * ✅ 변경사항
 * 1) Default Category 생성 시 파일등록폼 자동 생성 ❌ (없어도 됨)
 * 2) 사용자가 "카테고리 생성" 버튼을 눌러 카테고리를 만들 때만
 *    해당 카테고리 하단에 파일등록폼 1개 자동 생성 ✅
 * 3) 버전 입력칸: 1/6 크기로 축소 ✅
 * 4) 파일 선택 버튼: 드래그&드롭 박스 내부로 이동(박스 클릭으로 선택) ✅
 *
 * ⚠️ Firebase env 필요:
 * NEXT_PUBLIC_FIREBASE_API_KEY
 * NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 * NEXT_PUBLIC_FIREBASE_PROJECT_ID
 * NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 * NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 * NEXT_PUBLIC_FIREBASE_APP_ID
 */

import React, { useEffect, useMemo, useState } from "react";

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
 * Firebase init (이 파일에서 1회)
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

  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k);

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
  | "MOD_DELETE"
  | "SCAFFOLD_REPAIR";

export default function ProjectDocumentPage() {
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
  const [projectName, setProjectName] = useState("");

  // 상단 셀렉트용: 내가 만든 프로젝트 목록
  const [myProjects, setMyProjects] = useState<ProjectDoc[]>([]);
  // 현재 선택된 프로젝트
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // 선택된 프로젝트 기준 데이터
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [mods, setMods] = useState<ModDoc[]>([]);

  // 카테고리 생성 입력값
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
        setUploadFormsByNode({});
        return;
      }

      setUid(user.uid);
      setUserEmail(user.email ?? null);
    });

    return () => unsub();
  }, [auth]);

  useEffect(() => {
    if (!uid) return;
    void loadMyProjectsAndAutoSelect(uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (!activeProjectId) return;

    setProject(null);
    setNodes([]);
    setFiles([]);
    setMods([]);
    setUploadFormsByNode({}); // ✅ 프로젝트 전환 시 폼도 초기화(혼선 방지)

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
      map[k].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
    return {
      formId: makeLocalId("form"),
      displayName: "",
      version: "",
      fileObj: null,
      duplicateNameWarn: false,
    };
  }

  // ✅ 이제는 "자동 기본폼 강제 생성"을 하지 않습니다.
  // - 카테고리 생성 버튼(=새 카테고리 생성) 시 1개 자동 생성
  // - 사용자가 + 파일 등록폼 추가 버튼으로 생성
  function addOneUploadForm(nodeId: string) {
    setUploadFormsByNode((prev) => {
      const next = { ...prev };
      const arr = next[nodeId] ? [...next[nodeId]] : [];
      arr.push(createDefaultUploadForm());
      next[nodeId] = arr;
      return next;
    });
  }

  function tsToMillis(ts: any): number {
    try {
      if (!ts) return 0;
      if (typeof ts.toMillis === "function") return ts.toMillis();
      return 0;
    } catch {
      return 0;
    }
  }

  async function writeAudit(projectId: string, action: AuditAction, payload: Record<string, any>) {
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
   * 프로젝트 목록 로드
   * ------------------------------ */
  async function loadMyProjectsAndAutoSelect(myUid: string) {
    setLoading(true);
    try {
      const qy = query(collection(db, "project_documents"), where("createdBy", "==", myUid), limit(100));
      const snap = await getDocs(qy);
      const listRaw = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ProjectDoc[];

      const list = [...listRaw].sort((a, b) => tsToMillis(b.createdAt) - tsToMillis(a.createdAt));
      setMyProjects(list);

      if (!activeProjectId && list.length > 0) setActiveProjectId(list[0].id);
      if (activeProjectId && list.length > 0 && !list.some((p) => p.id === activeProjectId)) setActiveProjectId(list[0].id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] loadMyProjects failed:", e);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * (핵심) 노드가 없는 프로젝트 자동 복구 생성
   * ------------------------------ */
  async function ensureProjectScaffold(projectId: string, projectNameForRoot: string) {
    if (!uid) return;

    // 이미 root가 있으면 아무것도 하지 않음
    const hasRootLocal = nodes.some((n) => n.projectId === projectId && n.type === "project");
    if (hasRootLocal) return;

    // DB에서 nodes 직접 확인
    const nodesQ = query(collection(db, "project_document_nodes"), where("projectId", "==", projectId));
    const nSnap = await getDocs(nodesQ);
    if (nSnap.size > 0) return;

    // root node
    const rootRef = await addDoc(collection(db, "project_document_nodes"), {
      projectId,
      type: "project",
      parentId: null,
      name: projectNameForRoot || "Project",
      order: 0,
      createdBy: uid,
      createdByEmail: userEmail ?? null,
      createdAt: serverTimestamp(),
    });

    // default category (✅ 여기서는 폼 생성하지 않음)
    const defaultCategoryName = "Default Category";
    const categoryRef = await addDoc(collection(db, "project_document_nodes"), {
      projectId,
      type: "category",
      parentId: rootRef.id,
      name: defaultCategoryName,
      order: 1,
      createdBy: uid,
      createdByEmail: userEmail ?? null,
      createdAt: serverTimestamp(),
    });

    await writeAudit(projectId, "SCAFFOLD_REPAIR", {
      rootNodeId: rootRef.id,
      defaultCategoryId: categoryRef.id,
    });
  }

  /** -----------------------------
   * 선택된 프로젝트 하위 데이터 로드
   * ------------------------------ */
  async function loadProjectAll(projectId: string) {
    setLoading(true);
    try {
      const pSnap = await getDoc(doc(db, "project_documents", projectId));
      const pDoc = pSnap.exists() ? ({ id: pSnap.id, ...(pSnap.data() as any) } as ProjectDoc) : null;
      setProject(pDoc);

      // nodes
      const nodesQ = query(collection(db, "project_document_nodes"), where("projectId", "==", projectId));
      const nSnap = await getDocs(nodesQ);
      const nListRaw = nSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TreeNode[];
      const nList = [...nListRaw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setNodes(nList);

      // files
      const filesQ = query(collection(db, "project_document_files"), where("projectId", "==", projectId));
      const fSnap = await getDocs(filesQ);
      setFiles(fSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FileItem[]);

      // mods
      const modsQ = query(collection(db, "project_document_mods"), where("projectId", "==", projectId));
      const mSnap = await getDocs(modsQ);
      setMods(mSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ModDoc[]);

      // root가 없으면 자동 복구 후, 다시 로드
      const hasRoot = nList.some((n) => n.type === "project");
      if (!hasRoot) {
        await ensureProjectScaffold(projectId, pDoc?.name ?? "Project");

        const nSnap2 = await getDocs(nodesQ);
        const nList2Raw = nSnap2.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TreeNode[];
        const nList2 = [...nList2Raw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        setNodes(nList2);
      }

      // ✅ 여기서 폼 자동 생성하지 않음(요청사항)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] loadProjectAll failed:", e);
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 프로젝트 생성
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
      // 프로젝트 문서 생성
      const projectRef = await addDoc(collection(db, "project_documents"), {
        name,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 루트 노드 생성
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

      // 기본 카테고리 생성 (✅ 폼 자동 생성하지 않음)
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

      // 감사로그
      await writeAudit(projectRef.id, "PROJECT_CREATE", { name });
      await writeAudit(projectRef.id, "CATEGORY_CREATE", {
        nodeId: categoryRef.id,
        parentId: rootRef.id,
        name: defaultCategoryName,
        auto: true,
      });

      // 셀렉트 즉시 반영
      const newProject: ProjectDoc = {
        id: projectRef.id,
        name,
        createdBy: uid,
        createdByEmail: userEmail ?? null,
        createdAt: null,
      };
      setMyProjects((prev) => [newProject, ...prev]);

      // 자동 선택
      setActiveProjectId(projectRef.id);

      setProjectName("");

      await loadProjectAll(projectRef.id);
      await loadMyProjectsAndAutoSelect(uid);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ProjectDocument] handleCreateProject failed:", e);
      alert("프로젝트 생성 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  /** -----------------------------
   * 카테고리 생성/삭제
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
      const nextOrder = siblings.length ? Math.max(...siblings.map((s) => s.order ?? 0)) + 1 : 1;

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

      // ✅ 요청사항: 카테고리 생성 버튼을 눌렀을 때 등록폼이 1개 자동 생성
      setUploadFormsByNode((prev) => ({
        ...prev,
        [nodeRef.id]: [createDefaultUploadForm()],
      }));

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

      // 카테고리 폼도 같이 제거
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
    addOneUploadForm(nodeId);
  }

  function removeUploadForm(nodeId: string, formId: string) {
    setUploadFormsByNode((prev) => {
      const next = { ...prev };
      next[nodeId] = (next[nodeId] ?? []).filter((f) => f.formId !== formId);
      // ✅ 폼이 0개여도 괜찮음(요청사항에 맞춰 자동 생성하지 않음)
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

  function checkDuplicateName(nodeId: string, displayName: string): boolean {
    const dn = displayName.trim().toLowerCase();
    if (!dn) return false;
    return (filesByNode[nodeId] ?? []).some((f) => f.displayName.trim().toLowerCase() === dn);
  }

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

      // 업로드 후 파일만 비우기(폼은 유지)
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

      await writeAudit(activeProjectId, "MOD_CREATE", { modId: modRef.id, fileId: file.id, storagePath });
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

          <div className="flex items-center gap-2">
            <input
              className="border rounded px-2 py-1 text-sm w-48 bg-transparent"
              placeholder="하위 카테고리명"
              value={newCategoryNameByParent[node.id] ?? ""}
              onChange={(e) => setNewCategoryNameByParent((prev) => ({ ...prev, [node.id]: e.target.value }))}
              disabled={loading}
            />
            <button type="button" className="px-3 py-1 rounded border text-sm" onClick={() => handleAddCategory(node.id)} disabled={loading}>
              + 카테고리 생성
            </button>
          </div>
        </div>

        {node.type === "category" && (
          <div className="mt-4" style={{ paddingLeft: indent }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">📎 파일 등록</div>
              <button type="button" className="px-3 py-1 rounded border text-sm" onClick={() => addUploadForm(node.id)} disabled={loading}>
                + 파일 등록폼 추가
              </button>
            </div>

            <div className="space-y-3">
              {uploadForms.length === 0 ? (
                <div className="text-sm opacity-70">등록 폼이 없습니다. 우측의 “+ 파일 등록폼 추가”로 생성해 주세요.</div>
              ) : null}

              {uploadForms.map((form) => {
                const isDup = checkDuplicateName(node.id, form.displayName);

                // ✅ 파일 input id (label 클릭으로 파일 선택)
                const fileInputId = `file_${form.formId}`;

                return (
                  <div key={form.formId} className="border rounded p-3 bg-white dark:bg-black/30">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-sm font-semibold">등록 폼</div>
                      <button type="button" className="text-xs px-2 py-1 rounded border" onClick={() => removeUploadForm(node.id, form.formId)} disabled={loading}>
                        폼 제거
                      </button>
                    </div>

                    {/* ✅ md에서 6등분: 파일명(3/6) + 버전(1/6) + 파일(2/6) */}
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                      {/* 파일명(표시명) - 3/6 */}
                      <div className="flex flex-col gap-1 md:col-span-3">
                        <label className="text-xs opacity-70">파일명(표시명)</label>
                        <input
                          className="border rounded px-2 py-2 text-sm bg-transparent"
                          placeholder="예: CRF Specification"
                          value={form.displayName}
                          onChange={(e) => updateUploadForm(node.id, form.formId, { displayName: e.target.value, duplicateNameWarn: false })}
                          disabled={loading}
                        />
                        {(isDup || form.duplicateNameWarn) && (
                          <div className="text-xs text-red-600">동일 파일명이 존재합니다. 버전을 입력해 주세요.</div>
                        )}
                      </div>

                      {/* 버전 - 1/6 */}
                      <div className="flex flex-col gap-1 md:col-span-1">
                        <label className="text-xs opacity-70">버전</label>
                        <input
                          className="border rounded px-2 py-2 text-sm bg-transparent"
                          placeholder="v1.0"
                          value={form.version}
                          onChange={(e) => updateUploadForm(node.id, form.formId, { version: e.target.value })}
                          disabled={loading}
                        />
                      </div>

                      {/* 파일 - 2/6 */}
                      <div className="flex flex-col gap-1 md:col-span-2">
                        <label className="text-xs opacity-70">파일</label>

                        {/* ✅ 드래그&드롭 박스 안에 파일 선택 버튼(라벨) 포함 */}
                        <div
                          className="border rounded px-2 py-2 text-sm bg-transparent"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDrop(node.id, form.formId, e)}
                          title="여기에 파일을 드래그&드롭하거나, 박스 안의 파일 선택 버튼을 누르세요."
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate">
                              {form.fileObj ? `선택됨: ${form.fileObj.name}` : "여기로 드래그&드롭"}
                            </div>

                            {/* label 클릭 시 hidden input open */}
                            <label
                              htmlFor={fileInputId}
                              className="px-2 py-1 rounded border text-xs cursor-pointer whitespace-nowrap"
                              title="파일 선택"
                            >
                              파일 선택
                            </label>

                            <input
                              id={fileInputId}
                              type="file"
                              className="hidden"
                              onChange={(e) => updateUploadForm(node.id, form.formId, { fileObj: e.target.files?.[0] ?? null })}
                              disabled={loading}
                            />
                          </div>
                        </div>

                        <div className="text-xs opacity-70">{form.fileObj ? "선택된 파일 있음" : "선택된 파일 없음"}</div>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button type="button" className="px-3 py-2 rounded border text-sm" onClick={() => handleUpload(node.id, form)} disabled={loading}>
                        업로드
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

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
                              {f.displayName} {f.version ? <span className="text-xs opacity-70">({f.version})</span> : null}
                            </div>
                            <div className="text-xs opacity-70">원본 파일: {f.originalName}</div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {f.downloadUrl && (
                              <a className="px-3 py-1 rounded border text-sm" href={f.downloadUrl} target="_blank" rel="noreferrer">
                                다운로드
                              </a>
                            )}

                            <button type="button" className="px-3 py-1 rounded border text-sm" onClick={() => handleCreateMod(f)} disabled={loading}>
                              + Modification List 생성
                            </button>

                            <button type="button" className="px-3 py-1 rounded border text-sm" onClick={() => handleDeleteFile(f.id)} disabled={loading}>
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
                                  <button type="button" className="px-2 py-1 rounded border" onClick={() => handleDeleteMod(m.id)} disabled={loading}>
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
            <div className="text-xs opacity-70">저장 시 목록에 즉시 반영됩니다.</div>
          </div>

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
              <button type="button" className="px-4 py-2 rounded border" onClick={handleCreateProject} disabled={loading}>
                저장
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 text-sm">
          <span className="font-semibold">현재 프로젝트: </span>
          <span className="opacity-80">{activeProjectId ? `${project?.name ?? "(로드중)"} (${activeProjectId})` : "없음"}</span>
        </div>
      </section>

      {!activeProjectId ? (
        <div className="text-sm opacity-70">프로젝트를 선택(또는 생성)하면 하위 문서 트리가 표시됩니다.</div>
      ) : (
        <section>
          {loading && <div className="text-sm opacity-70 mb-3">처리 중...</div>}
          {!rootNodeId ? (
            <div className="text-sm opacity-70">프로젝트 노드를 불러오지 못했습니다. (노드가 없으면 자동 복구 생성됩니다)</div>
          ) : (
            nodes
              .filter((n) => n.id === rootNodeId)
              .map((root) => renderNode(root, 0))
          )}
        </section>
      )}
    </main>
  );
}
