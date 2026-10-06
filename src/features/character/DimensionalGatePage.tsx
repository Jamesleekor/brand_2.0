import { PageHeader } from '@/components/shared/components';
import DimensionalGatePanel from './DimensionalGatePanel';

export default function DimensionalGatePage() {
  return (
    <>
      <PageHeader title="차원관문" emoji="🔮" />
      <main className="px-4 pb-6 pt-4 lg:px-5 lg:pt-5">
        <DimensionalGatePanel />
      </main>
    </>
  );
}
