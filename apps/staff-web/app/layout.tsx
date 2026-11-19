import type { Metadata } from 'next';
import { StaffShell } from '@/components/premium/StaffShell';
import { DisplayProvider } from '@/components/premium/DisplayPreferences';
import { Providers } from '@/components/Providers';
import './globals.css';
import 'leaflet/dist/leaflet.css';
import './care-continuity.css';
import './premium-clinical.css';
import './research-portal.css';
import './brand-system.css';
import './experience.css';
import { displayBootstrap } from '@/lib/premium/displayPreferences';

/*
 * One family across the scale; weight and size carry the hierarchy. Plex Mono
 * appears only on countdowns and lab values, where tabular figures stop the
 * number jittering as it ticks and keep a column of results aligned — both
 * cases where the digits are the content, not decoration.
 */
export const metadata: Metadata = {
  title: 'A-Health',
  description: 'Connecting Healthcare. Empowering Lives.',
  icons: {icon:'/brand/app-icon-48.png',apple:'/brand/app-icon-180.png'},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <script dangerouslySetInnerHTML={{ __html: displayBootstrap }} />
        <Providers>
          <DisplayProvider><StaffShell>{children}</StaffShell></DisplayProvider>
        </Providers>
      </body>
    </html>
  );
}
