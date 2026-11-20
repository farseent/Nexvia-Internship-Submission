import type { Metadata } from 'next';
import { PageView } from '@/components/page-view';

export const metadata: Metadata = { title: 'Page · CoNote' };

export default async function PageRoute({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  return <PageView pageId={pageId} />;
}
