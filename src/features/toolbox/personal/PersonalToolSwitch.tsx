import type { PersonalToolProps } from './common';
import type { PersonalToolId } from '../toolbox_types';
import { LotteryTool } from './LotteryTool';
import { LadderTool } from './LadderTool';
import { RouletteTool } from './RouletteTool';
import { OrderTool } from './OrderTool';
import { TimerTool } from './TimerTool';
import { TeamMakerTool } from './TeamMakerTool';

export function PersonalToolSwitch({ tool, props }: { tool: PersonalToolId; props: PersonalToolProps }) {
  switch (tool) {
    case 'lottery': return <LotteryTool {...props} />;
    case 'ladder': return <LadderTool {...props} />;
    case 'roulette': return <RouletteTool {...props} />;
    case 'order': return <OrderTool {...props} />;
    case 'timer': return <TimerTool {...props} />;
    case 'teams': return <TeamMakerTool {...props} />;
    default: return null;
  }
}
