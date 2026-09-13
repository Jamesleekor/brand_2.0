import { useSearchParams } from 'react-router-dom';
import TeacherArcadeLegacyPage from './TeacherArcadeLegacyPage';
import TeacherTikatukaAdminPage from './TeacherTikatukaAdminPage';

export default function TeacherArcadePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('game');

  if (mode === 'tikatuka') return <TeacherTikatukaAdminPage />;

  return (
    <>
      <div className="fixed bottom-24 right-4 z-40 md:bottom-auto md:right-6 md:top-[76px]">
        <button
          type="button"
          className="rounded-card-lg border border-brand-primary/40 bg-bg-overlay px-4 py-3 text-sm font-black text-white shadow-card backdrop-blur-card transition hover:-translate-y-0.5 hover:border-brand-primary/70"
          onClick={() => setSearchParams({ game: 'tikatuka' })}
        >
          🛡️ 라카루카 관리
        </button>
      </div>
      <TeacherArcadeLegacyPage />
    </>
  );
}
