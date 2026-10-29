import { cookies } from 'next/headers';
import HomeClient from './home-client';
import { readDismissed } from './coming-up';

// Home. Screens matched: docs/design/html/Chat.html (greeting, Coming up,
// composer) and docs/design/html/PlusMenu.html (upload overlay, in chrome).
// The Coming up dismissal is read from the request cookie here, before
// first paint, so server HTML and the first client render always agree.

export const metadata = {
  title: 'Mizzou — home',
};

export default async function HomePage() {
  const jar = await cookies();
  const dismissed = readDismissed(jar.toString());
  return <HomeClient dismissedServer={dismissed} />;
}
