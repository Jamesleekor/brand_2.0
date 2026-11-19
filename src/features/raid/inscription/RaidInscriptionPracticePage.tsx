// RAID_INSCRIPTION_V1_20261118 — 학생용 「주문 각인 연습장」 페이지 (/raid/practice/inscription)
// 레이드가 열려 있지 않아도 들어올 수 있다. 서버에 아무것도 보내지 않는다.
import { useNavigate } from 'react-router-dom';

import InscriptionPractice from './InscriptionPractice';

export default function RaidInscriptionPracticePage() {
  const navigate = useNavigate();
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#090a16] px-4 py-6 text-white md:px-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 12%, rgba(176,120,255,0.18), transparent 34%), linear-gradient(180deg,#0d0b1c 0%,#090a16 60%,#06060f 100%)' }}
      />
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => navigate('/raid')}
              className="mb-3 rounded-card-md border border-[#c9a6ff]/40 bg-[#1b1430]/80 px-3 py-2 text-xs font-black text-[#e6d9ff]"
            >
              ← 레이드 관문
            </button>
            <div className="text-xs font-black tracking-[0.2em] text-[#d4b6ff]">PRACTICE · 주문 각인</div>
            <h1 className="mt-1 text-3xl font-black text-white" style={{ fontFamily: "'Noto Serif KR', 'Nanum Myeongjo', serif" }}>
              주문 각인 연습장
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-[#e6d9ff]">
              레이드 중 보스가 「주문 각인」을 쓰면, 선발된 모험가가 화면의 알파벳을 제한 시간 안에 순서대로 쳐야 해요.
              모두 성공하면 보스에게 큰 피해를 주고 공명방벽이 회복되지만, 실패하면 몇 명이 「타락」해 공격이 보스를 회복시켜요.
            </p>
          </div>
        </header>
        <InscriptionPractice />
      </div>
    </div>
  );
}
