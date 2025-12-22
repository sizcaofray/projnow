// lib/firebase/client.ts
// - Firebase Client SDK 초기화(중복 초기화 방지)
// - Auth / Firestore 인스턴스를 싱글톤으로 제공
// - NEXT_PUBLIC_FIREBASE_* 환경변수가 없으면 명확한 에러를 던짐

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
// ✅ Firestore 추가
import { getFirestore, type Firestore } from "firebase/firestore";

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
// ✅ Firestore 싱글톤
let _db: Firestore | null = null;

/** Firebase App 싱글톤 반환 */
export function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;

  // ✅ 환경변수 기반 설정 (Vercel에도 동일하게 등록 필요)
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  // ✅ 필수값 최소 체크 (누락 시 런타임에서 명확히 알 수 있게)
  const required = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.projectId,
    firebaseConfig.appId,
  ];

  if (required.some((v) => !v)) {
    throw new Error(
      "Firebase 환경변수가 누락되었습니다. NEXT_PUBLIC_FIREBASE_* 값을 확인해주세요."
    );
  }

  _app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return _app;
}

/** Firebase Auth 싱글톤 반환 */
export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;

  const app = getFirebaseApp();
  _auth = getAuth(app);
  return _auth;
}

/** ✅ Firestore 싱글톤 반환 */
export function getFirebaseDb(): Firestore {
  if (_db) return _db;

  const app = getFirebaseApp();
  _db = getFirestore(app);
  return _db;
}
