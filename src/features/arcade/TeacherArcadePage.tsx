import { useSearchParams } from 'react-router-dom';
import TeacherArcadeLegacyPage from './TeacherArcadeLegacyPage';
import TeacherTikatukaAdminPage from './TeacherTikatukaAdminPage';

type ReactionPanel = 'overview' | 'verification' | 'records' | 'audit';
type RakarukaPanel = 'overview' | 'official' | 'records' | 'progress';

const REACTION_PANELS: readonly ReactionPanel[] = ['overview', 'verification', 'records', 'audit'];
const RAKARUKA_PANELS: readonly RakarukaPanel[] = ['overview', 'official', 'records', 'progress'];

export default function TeacherArcadePage() {
  const [searchParams] = useSearchParams();
  const requestedGame = searchParams.get('game');
  const requestedPanel = searchParams.get('panel');

  if (requestedGame === 'rakaruka' || requestedGame === 'tikatuka') {
    const activePanel = RAKARUKA_PANELS.find((panel) => panel === requestedPanel) ?? 'overview';
    return <TeacherTikatukaAdminPage key="rakaruka" activePanel={activePanel} />;
  }

  if (requestedGame === 'periods') {
    return <TeacherArcadeLegacyPage key="periods" selectedGameCode="focus_reaction_01" activePanel="periods" />;
  }

  const isPure = requestedGame === 'pure';
  const activePanel = REACTION_PANELS.find((panel) => panel === requestedPanel) ?? 'overview';
  return (
    <TeacherArcadeLegacyPage
      key={isPure ? 'pure' : 'focus'}
      selectedGameCode={isPure ? 'pure_reaction_02' : 'focus_reaction_01'}
      activePanel={activePanel}
    />
  );
}
