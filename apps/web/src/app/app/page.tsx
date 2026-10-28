import HomeClient from "./home-client";

// Home. Screens matched: docs/design/html/Chat.html (greeting, Coming up,
// composer) and docs/design/html/PlusMenu.html (upload overlay, in chrome).

export const metadata = {
  title: "Mizzou — home",
};

export default function HomePage() {
  return <HomeClient />;
}
