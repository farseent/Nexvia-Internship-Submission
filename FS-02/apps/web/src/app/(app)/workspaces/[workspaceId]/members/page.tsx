import type { Metadata } from 'next';
import { MembersManager } from '@/components/members-manager';

export const metadata: Metadata = { title: 'Members · CoNote' };

export default function MembersPage() {
  return <MembersManager />;
}
