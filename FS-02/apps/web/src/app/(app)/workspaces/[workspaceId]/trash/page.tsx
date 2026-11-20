import type { Metadata } from 'next';
import { TrashList } from '@/components/trash-list';

export const metadata: Metadata = { title: 'Trash · CoNote' };

export default function TrashPage() {
  return <TrashList />;
}
