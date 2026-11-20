import { NextResponse } from 'next/server';
import type { Liveness } from '@conote/shared';

// Liveness only: independent of every dependency.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse<Liveness> {
  return NextResponse.json({ status: 'ok', service: 'web' });
}
