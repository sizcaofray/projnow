// lib/firebase/client.ts
// - Firebase Client SDK 초기화/재사용 유틸
// - 중복 초기화 방지(getApps)
// - 환경변수 누락 방어

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/** Firebase App을 싱글톤으로 가져옵니다. */
export function getFirebaseApp(): FirebaseApp {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, // 필수
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, // 필수
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, // 필수
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID, // 필수
  };

  // 필수 키 누락 방어 (운영/배포 환경에서 흔한 실수 예방)
  const required = [
    firebaseConfig.apiKey,
    firebaseConfig.authDomain,
    firebaseConfig.projectId,
    firebaseConfig.appId,
  ];
  if (required.some((v) => !v)) {
    throw new Error(
      "Firebase 환경변수가 누락되었습니다. NEXT_PUBLIC_FIREBASE_* 값을 설정해주세요."
    );
  }

  // 이미 초기화된 앱이 있으면 재사용
  return getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
}

/** Firebase Auth 인스턴스를 가져옵니다. */
export function getFirebaseAuth(): Auth {
  const app = getFirebaseApp();
  return getAuth(app);
}
