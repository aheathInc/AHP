import {requireRole} from '@/lib/roles';
import {NetworkModeration} from '@/components/NetworkModeration';
export default async function Page(){await requireRole(['platform_admin']);return <NetworkModeration/>;}
